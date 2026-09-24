import type { Txn } from "./types";

/**
 * Rules learned from Tom's Google Sheets / Excel budget tracker:
 * - every Payment Log row teaches "this description → this exact category"
 * - Sheet1 formulas say which categories are committed, which are debts, and the budget per category
 * - the Debt Tracker tab gives balances, payments and APRs
 */

export type TrackerRole =
  | "employed"
  | "self-employed"
  | "income"
  | "rent-offset"
  | "expense"
  | "subscription"
  | "fee"
  | "debt"
  | "transfer";

export type TrackerCategory = { name: string; role: TrackerRole; committed: boolean; budget?: number };

export type TrackerDebt = { name: string; lender: string; balance: number; payment: number; apr: number };

export type TrackerConfig = {
  file: string;
  importedAt: string;
  /** Learned from the Payment Log: normalised description + money direction → category */
  merchants: Record<string, { category: string; count: number; agree: number }>;
  /** First-word fallback, only kept when the log is consistent about it */
  words: Record<string, { category: string; count: number }>;
  categories: TrackerCategory[];
  debts: TrackerDebt[];
  logRows: number;
  learnedRows: number;
  skipped: { row: number; reason: string; raw: string }[];
};

/* ------------------------------------------------------------------ */
/* Category roles (exact names from the tracker)                       */
/* ------------------------------------------------------------------ */

const DEBT = ["Van Loan", "Natwest Car Loan", "Mum & Dad", "Barclaycard", "Capital One", "Klarna", "Fluid", "Clearpay"];
const TRANSFER = ["Savings Pot", "Personal Transfer"];
const SUBSCRIPTION = [
  "Subscriptions", "Perks", "Patreon", "MyBuilder", "Apple", "Amazon Prime", "Google One", "OpenAI", "Anthropic",
  "IONOS", "Vercel", "Ideogram AI",
];
const FEE = ["Bank Charges"];
const EMPLOYED = ["Income - Trade Plates"];
const SELF_EMPLOYED = ["Income - Gardening", "Income - Gardens", "Income - Business"];
const OTHER_INCOME = ["Income - Sale", "Income - Family", "Income - Other", "Website", "Firestick money", "Friends - money"];
/** Used when the workbook's committed-outgoings formula can't be read */
const COMMITTED_FALLBACK = [
  "Rent", "Income - Rent", "Joint Account", "Santander Bills", "Fulwood Tennis", "DVLA", "Medical", "NHS Prescription",
  "RAC Breakdown", "Business Insurance", "Business", "Insurance", ...SUBSCRIPTION, ...DEBT,
];

export function roleFor(category: string): TrackerRole {
  if (category === "Income - Rent") return "rent-offset"; // rent contributions are netted against Rent
  if (DEBT.includes(category)) return "debt";
  if (TRANSFER.includes(category)) return "transfer";
  if (SUBSCRIPTION.includes(category)) return "subscription";
  if (FEE.includes(category)) return "fee";
  if (EMPLOYED.includes(category)) return "employed";
  if (SELF_EMPLOYED.includes(category)) return "self-employed";
  if (OTHER_INCOME.includes(category) || /^income\b/i.test(category)) return "income";
  return "expense";
}

/* ------------------------------------------------------------------ */
/* Matching keys                                                       */
/* ------------------------------------------------------------------ */

/** Letters only, upper case, single spaces. The same function is used for learning and matching. */
export const trackerKey = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const STOP = new Set(["CARD", "PAYMENT", "TRANSFER", "FROM", "DIRECT", "DEBIT", "FASTER", "THE", "LTD", "LIMITED", "WWW", "COM", "UK"]);
const firstWord = (key: string) => key.split(" ").find((w) => w.length >= 4 && !STOP.has(w));

const dir = (amount: number) => (amount >= 0 ? "in" : "out");

/* ------------------------------------------------------------------ */
/* Read the workbook                                                   */
/* ------------------------------------------------------------------ */

export async function parseTrackerWorkbook(data: ArrayBuffer, file: string): Promise<TrackerConfig> {
  const XLSX = await import("xlsx"); // loaded only when a tracker is imported
  const wb = XLSX.read(data, { cellDates: true, cellFormula: true });
  const skipped: TrackerConfig["skipped"] = [];

  /* ---- Payment Log: learn every row ---- */
  const logName = wb.SheetNames.find((n) => /payment\s*log/i.test(n));
  if (!logName) throw new Error("No 'Payment Log' tab found in this workbook.");
  const log = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[logName], { header: 1, raw: true, blankrows: false });
  const headerIdx = log.findIndex((r) => r.some((c) => /description/i.test(String(c ?? ""))));
  if (headerIdx < 0) throw new Error("The Payment Log has no Description column.");
  const header = log[headerIdx].map((c) => String(c ?? "").toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cDesc = col(/description/);
  const cAmt = col(/amount/);
  const cCat = col(/category/);
  if (cAmt < 0 || cCat < 0) throw new Error("The Payment Log needs Amount and Category columns.");

  const votes = new Map<string, Map<string, number>>();
  const wordVotes = new Map<string, Map<string, number>>();
  const allCategories = new Set<string>();
  let logRows = 0;
  let learnedRows = 0;

  log.slice(headerIdx + 1).forEach((r, i) => {
    const rowNo = headerIdx + i + 2;
    const desc = String(r[cDesc] ?? "").trim();
    const cat = String(r[cCat] ?? "").trim();
    const amount = typeof r[cAmt] === "number" ? (r[cAmt] as number) : parseFloat(String(r[cAmt] ?? "").replace(/[£,]/g, ""));
    if (!desc && !cat && !Number.isFinite(amount)) return; // truly empty row
    logRows++;
    const raw = r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? ""))).join(" | ");
    if (!desc) return void skipped.push({ row: rowNo, reason: "No description", raw });
    if (!cat) return void skipped.push({ row: rowNo, reason: "No category (still needs review in the tracker)", raw });
    if (!Number.isFinite(amount)) return void skipped.push({ row: rowNo, reason: "Amount isn't a number", raw });

    allCategories.add(cat);
    const key = trackerKey(desc);
    if (!key) return void skipped.push({ row: rowNo, reason: "Description has no letters to match on", raw });
    const k = `${key}|${dir(amount)}`;
    const v = votes.get(k) ?? new Map<string, number>();
    v.set(cat, (v.get(cat) ?? 0) + 1);
    votes.set(k, v);

    const w = firstWord(key);
    if (w) {
      const wk = `${w}|${dir(amount)}`;
      const wv = wordVotes.get(wk) ?? new Map<string, number>();
      wv.set(cat, (wv.get(cat) ?? 0) + 1);
      wordVotes.set(wk, wv);
    }
    learnedRows++;
  });

  const merchants: TrackerConfig["merchants"] = {};
  for (const [k, v] of votes) {
    const sorted = [...v.entries()].sort((a, b) => b[1] - a[1]);
    const count = sorted.reduce((s, [, n]) => s + n, 0);
    merchants[k] = { category: sorted[0][0], count, agree: sorted[0][1] };
  }

  // A first word only becomes a rule if the log almost always agrees on it
  const words: TrackerConfig["words"] = {};
  for (const [k, v] of wordVotes) {
    const sorted = [...v.entries()].sort((a, b) => b[1] - a[1]);
    const count = sorted.reduce((s, [, n]) => s + n, 0);
    if (count >= 3 && sorted[0][1] / count >= 0.85) words[k] = { category: sorted[0][0], count };
  }

  /* ---- Sheet1: committed categories and budgets, read from its formulas ---- */
  const committed = new Set<string>();
  const budgets = new Map<string, number>();
  const main = wb.Sheets[wb.SheetNames.find((n) => /^sheet1$|expenditure/i.test(n)) ?? ""];
  if (main) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(main, { header: 1, raw: true, blankrows: true });
    const catsIn = (addr: string) => {
      const f = main[addr]?.f as string | undefined;
      return f ? [...f.matchAll(/\$D\$\d+="([^"]+)"/g)].map((m) => m[1]) : [];
    };
    let section: "committed" | "variable" | null = null;
    rows.forEach((r, i) => {
      const label = String(r[0] ?? "").trim();
      const addrE = `E${i + 1}`;
      // Section headings in Sheet1, e.g. "LOANS", "CREDIT CARDS", "COMMITTED BILLS", "VARIABLE SPENDING — day to day"
      if (/^(LOANS|CREDIT CARDS|COMMITTED BILLS)$/i.test(label)) section = "committed";
      if (/^VARIABLE SPENDING/i.test(label)) section = "variable";
      if (/^(EARNED INCOME|MONEY RECEIVED|MONTHLY SUMMARY)$/i.test(label)) section = null;
      if (/^TOTAL COMMITTED/i.test(label)) {
        catsIn(addrE).forEach((c) => committed.add(c));
        return;
      }
      if (/^TOTAL/i.test(label)) return;
      const cats = catsIn(addrE);
      if (section === "committed") cats.forEach((c) => committed.add(c));
      if (section === "variable" && cats.length === 1 && typeof r[1] === "number") budgets.set(cats[0], r[1] as number);
    });
  }
  if (!committed.size) COMMITTED_FALLBACK.forEach((c) => committed.add(c));
  // Only spending can be committed
  for (const c of [...committed]) if (/^income\b/i.test(c) && c !== "Income - Rent") committed.delete(c);
  OTHER_INCOME.forEach((c) => committed.delete(c));

  const categories: TrackerCategory[] = [...new Set([...allCategories, ...committed, ...budgets.keys()])]
    .sort()
    .map((name) => ({ name, role: roleFor(name), committed: committed.has(name), budget: budgets.get(name) }));

  /* ---- Debt Tracker ---- */
  const debts: TrackerDebt[] = [];
  const debtName = wb.SheetNames.find((n) => /debt/i.test(n));
  if (debtName) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[debtName], { header: 1, raw: true, blankrows: false });
    const h = rows.findIndex((r) => /creditor/i.test(String(r[0] ?? "")));
    if (h >= 0) {
      const hdr = rows[h].map((c) => String(c ?? "").toLowerCase());
      const ci = (re: RegExp) => hdr.findIndex((x) => re.test(x));
      const [cL, cB, cP, cA] = [ci(/lender/), ci(/balance/), ci(/payment/), ci(/apr/)];
      for (const r of rows.slice(h + 1)) {
        const name = String(r[0] ?? "").trim();
        if (!name || typeof r[cB] !== "number") break;
        const balance = r[cB] as number;
        const payment = typeof r[cP] === "number" ? (r[cP] as number) : 0;
        if (balance <= 0 && payment <= 0) continue;
        const aprRaw = typeof r[cA] === "number" ? (r[cA] as number) : 0;
        debts.push({
          name,
          lender: String(r[cL] ?? ""),
          balance,
          payment,
          apr: aprRaw > 0 && aprRaw < 1 ? Math.round(aprRaw * 1000) / 10 : aprRaw, // stored as 0.265 → 26.5
        });
      }
    }
  }

  return { file, importedAt: new Date().toISOString(), merchants, words, categories, debts, logRows, learnedRows, skipped };
}

/* ------------------------------------------------------------------ */
/* Apply to a transaction                                              */
/* ------------------------------------------------------------------ */

/** certain = the Payment Log always used this category for this description */
export type TrackerMatch = { category: string; role: TrackerRole; how: "exact" | "contains" | "word"; certain: boolean };

export function matchTracker(t: Txn, cfg: TrackerConfig | null): TrackerMatch | null {
  if (!cfg) return null;
  const d = dir(t.amountPence);
  const candidates = [...new Set([trackerKey(t.description), trackerKey(t.name), trackerKey(`${t.name} ${t.description}`)])].filter(Boolean);
  const role = (category: string) => cfg.categories.find((c) => c.name === category)?.role ?? roleFor(category);

  // 1. Exact description seen before in the Payment Log
  for (const k of candidates) {
    const m = cfg.merchants[`${k}|${d}`];
    if (m) return { category: m.category, role: role(m.category), how: "exact", certain: m.agree === m.count };
  }

  // 2. A learned description appears inside this one (longest wins; short keys are too vague)
  let best: { key: string; category: string; certain: boolean } | null = null;
  for (const [mk, m] of Object.entries(cfg.merchants)) {
    const [key, mdir] = mk.split("|");
    if (mdir !== d || key.length < 6) continue;
    if (candidates.some((c) => ` ${c} `.includes(` ${key} `)) && (!best || key.length > best.key.length)) {
      best = { key, category: m.category, certain: m.agree === m.count };
    }
  }
  if (best) return { category: best.category, role: role(best.category), how: "contains", certain: best.certain };

  // 3. First word the log is consistent about (e.g. every "GREGGS" was Food / Drink)
  for (const k of candidates) {
    const w = firstWord(k);
    const m = w ? cfg.words[`${w}|${d}`] : undefined;
    if (m) return { category: m.category, role: role(m.category), how: "word", certain: false };
  }
  return null;
}
