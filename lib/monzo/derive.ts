import { hash } from "./common";
import type { AccountKind, Rule, Txn, TxnClass } from "./types";

type Freq = "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";

export type DerivedIncome = { id: string; source: string; kind: string; amount: number; frequency: Freq };
export type DerivedExpense = { id: string; name: string; category: string; amount: number; frequency: Freq; essential: boolean };
export type DerivedSubscription = { id: string; name: string; amount: number; frequency: Freq; renews: string; worthIt: boolean };
export type DerivedFee = { id: string; name: string; amount: number; frequency: Freq; avoidable: boolean };
export type DerivedAccount = { id: string; name: string; type: string; balance: number };

export type Classified = Txn & { cls: TxnClass; category: string; subFreq?: Freq };

export const DERIVED_PREFIX = "monzo-";

const ESSENTIAL = new Set(["Housing", "Bills", "Food", "Transport", "Insurance"]);

const MONZO_TO_DASH: Record<string, string> = {
  groceries: "Food",
  "eating out": "Fun",
  entertainment: "Fun",
  holidays: "Fun",
  bills: "Bills",
  transport: "Transport",
  shopping: "Personal",
  "personal care": "Personal",
  family: "Personal",
  gifts: "Personal",
  charity: "Other",
  general: "Other",
  cash: "Other",
  expenses: "Business",
  finances: "Other",
};

const KEYWORDS: [RegExp, string][] = [
  [/\b(rent|mortgage|letting|landlord)\b/i, "Housing"],
  [/council tax|octopus|british gas|edf|e\.on|ovo|scottish power|yorkshire water|water|energy|virgin media|bt group|sky|broadband|tv licen/i, "Bills"],
  [/insurance|admiral|aviva|direct line|churchill|hastings|axa/i, "Insurance"],
  [/tesco|asda|aldi|lidl|sainsbury|morrisons|co-?op|iceland|waitrose|m&s food|farmfoods|greggs/i, "Food"],
  [/shell|\bbp\b|esso|texaco|petrol|fuel|uber|trainline|northern|stagecoach|first bus|parking|dvla|halfords/i, "Transport"],
  [/deliveroo|just eat|uber eats|mcdonald|kfc|nando|costa|starbucks|pub|bar\b|cinema|steam|playstation|xbox/i, "Fun"],
];

const FEE = /\b(fee|fees|charge|charges|overdraft|commission|interest charged|late payment|arrangement)\b/i;
const TRANSFER = /\bpot\b|savings pot|to pot|from pot|round ?up|transfer (to|from) (personal|business|joint)/i;

export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9& ]/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function ruleFor(t: Txn, rules: Rule[]) {
  const hay = `${t.name} ${t.description}`.toLowerCase();
  return rules.find((r) => r.match.trim() && hay.includes(r.match.trim().toLowerCase()));
}

function categorise(t: Txn): string {
  if (t.account === "business") return "Business";
  const text = `${t.name} ${t.description}`;
  for (const [re, cat] of KEYWORDS) if (re.test(text)) return cat;
  const mc = t.monzoCategory?.toLowerCase();
  if (mc && MONZO_TO_DASH[mc]) return MONZO_TO_DASH[mc];
  return "Other";
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function freqFromInterval(days: number): Freq | null {
  if (days >= 6 && days <= 8) return "weekly";
  if (days >= 13 && days <= 16) return "fortnightly";
  if (days >= 26 && days <= 35) return "monthly";
  if (days >= 85 && days <= 97) return "quarterly";
  if (days >= 350 && days <= 380) return "yearly";
  return null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Spot regular payments to the same merchant at a steady amount. */
function detectSubscriptions(out: Txn[]) {
  const byName = new Map<string, Txn[]>();
  out.forEach((t) => {
    const k = `${t.account}|${normName(t.name)}`;
    byName.set(k, [...(byName.get(k) ?? []), t]);
  });
  const subs = new Map<string, Freq>(); // key -> frequency
  for (const [k, list] of byName) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((t) => Math.abs(t.amountPence));
    const med = median(amounts);
    if (!amounts.every((a) => Math.abs(a - med) <= med * 0.15)) continue;
    const intervals = sorted.slice(1).map((t, i) => daysBetween(sorted[i].date, t.date));
    const f = freqFromInterval(median(intervals));
    if (!f) continue;
    if (f === "weekly" && list.length < 3) continue;
    subs.set(k, f);
  }
  return subs;
}

export function classify(txns: Txn[], rules: Rule[]): Classified[] {
  const base = txns.map((t) => {
    const rule = ruleFor(t, rules);
    let cls: TxnClass;
    if (rule) cls = rule.class;
    else if (/pot transfer/i.test(t.type ?? "") || TRANSFER.test(`${t.name} ${t.description}`)) cls = "transfer";
    else if (t.amountPence < 0 && FEE.test(`${t.name} ${t.description} ${t.type ?? ""}`)) cls = "fee";
    else if (t.amountPence > 0 && /card payment/i.test(t.type ?? "")) cls = "expense"; // refund nets against spending
    else cls = t.amountPence >= 0 ? "income" : "expense";
    return { ...t, cls, category: rule?.category || categorise(t) } as Classified;
  });

  // Bills, rent, food and fuel repeat too, but they belong in expenses, not subscriptions
  const subKeys = detectSubscriptions(
    base.filter((t) => t.cls === "expense" && t.amountPence < 0 && !ruleFor(t, rules) && !ESSENTIAL.has(t.category))
  );
  return base.map((t) => {
    const f = subKeys.get(`${t.account}|${normName(t.name)}`);
    return f && t.cls === "expense" && t.amountPence < 0 ? { ...t, cls: "subscription", subFreq: f } : t;
  });
}

function addInterval(iso: string, f: Freq) {
  const d = new Date(iso + "T00:00:00Z");
  if (f === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (f === "fortnightly") d.setUTCDate(d.getUTCDate() + 14);
  else if (f === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (f === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

const label = (a: AccountKind) => (a === "business" ? "business" : "personal");

/** Build dashboard rows from imported transactions. Amounts are monthly averages over the imported period. */
export function deriveDashboard(txns: Txn[], rules: Rule[]): Derived {
  const cls = classify(txns, rules);
  if (!cls.length) return { income: [], expenses: [], subscriptions: [], fees: [], accounts: [], classified: [], months: 1, monthly: [] };
  return build(cls);
}

export type Derived = ReturnType<typeof build>;

function build(cls: Classified[]) {
  const dates = cls.map((t) => t.date).sort();
  // Average over the calendar months the statements cover (statements are usually whole months)
  const months = Math.max(1, new Set(dates.map((d) => d.slice(0, 7))).size);
  const perMonth = (pence: number) => Math.round(pence / months) / 100;

  // Income: grouped by payer and account
  const incomeGroups = new Map<string, { name: string; account: AccountKind; total: number; count: number }>();
  cls.filter((t) => t.cls === "income").forEach((t) => {
    const k = `${t.account}|${normName(t.name)}`;
    const g = incomeGroups.get(k) ?? { name: t.name, account: t.account, total: 0, count: 0 };
    g.total += t.amountPence;
    g.count++;
    incomeGroups.set(k, g);
  });
  const income: DerivedIncome[] = [...incomeGroups.entries()]
    .map(([k, g]) => ({
      id: `${DERIVED_PREFIX}inc-${hash(k)}`,
      source: `${g.name} (Monzo ${label(g.account)})`,
      kind:
        g.account === "business"
          ? "Self-employed (before tax)"
          : g.count >= Math.floor(months) && g.count >= 2
          ? "Employed (take-home)"
          : "Other",
      amount: perMonth(g.total),
      frequency: "monthly" as Freq,
    }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // Expenses: grouped by dashboard category and account
  const expGroups = new Map<string, { category: string; account: AccountKind; total: number }>();
  cls.filter((t) => t.cls === "expense").forEach((t) => {
    const k = `${t.account}|${t.category}`;
    const g = expGroups.get(k) ?? { category: t.category, account: t.account, total: 0 };
    g.total += -t.amountPence;
    expGroups.set(k, g);
  });
  const expenses: DerivedExpense[] = [...expGroups.entries()]
    .map(([k, g]) => ({
      id: `${DERIVED_PREFIX}exp-${hash(k)}`,
      name: `${g.category} (Monzo ${label(g.account)})`,
      category: g.category,
      amount: perMonth(g.total),
      frequency: "monthly" as Freq,
      essential: ESSENTIAL.has(g.category),
    }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // Subscriptions: one row per merchant at its detected frequency
  const subGroups = new Map<string, Classified[]>();
  cls.filter((t) => t.cls === "subscription").forEach((t) => {
    const k = `${t.account}|${normName(t.name)}`;
    subGroups.set(k, [...(subGroups.get(k) ?? []), t]);
  });
  const subscriptions: DerivedSubscription[] = [...subGroups.entries()].map(([k, list]) => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1];
    const f = last.subFreq ?? "monthly";
    return {
      id: `${DERIVED_PREFIX}sub-${hash(k)}`,
      name: last.name,
      amount: Math.abs(last.amountPence) / 100,
      frequency: f,
      renews: addInterval(last.date, f),
      worthIt: true,
    };
  });

  // Fees: grouped by description
  const feeGroups = new Map<string, { name: string; total: number }>();
  cls.filter((t) => t.cls === "fee").forEach((t) => {
    const k = `${t.account}|${normName(t.name)}`;
    const name = FEE.test(t.name) || !t.description ? t.name : `${t.name}: ${t.description}`;
    const g = feeGroups.get(k) ?? { name, total: 0 };
    g.total += -t.amountPence;
    feeGroups.set(k, g);
  });
  const fees: DerivedFee[] = [...feeGroups.entries()].map(([k, g]) => ({
    id: `${DERIVED_PREFIX}fee-${hash(k)}`,
    name: g.name,
    amount: perMonth(g.total),
    frequency: "monthly",
    avoidable: /overdraft|late|interest/i.test(g.name),
  }));

  // Account balances: latest running balance from PDF statements
  const accounts: DerivedAccount[] = [];
  (["personal", "business"] as AccountKind[]).forEach((a) => {
    const withBal = cls
      .filter((t) => t.account === a && t.balancePence !== undefined)
      .sort((x, y) => x.date.localeCompare(y.date));
    if (withBal.length) {
      accounts.push({
        id: `${DERIVED_PREFIX}acc-${a}`,
        name: `Monzo ${label(a)}`,
        type: "Current",
        balance: withBal[withBal.length - 1].balancePence! / 100,
      });
    }
  });

  // Actual money in / out per calendar month (transfers and ignored rows excluded)
  const monthMap = new Map<string, { month: string; moneyIn: number; moneyOut: number }>();
  cls.filter((t) => t.cls !== "transfer" && t.cls !== "ignore").forEach((t) => {
    const m = t.date.slice(0, 7);
    const g = monthMap.get(m) ?? { month: m, moneyIn: 0, moneyOut: 0 };
    if (t.cls === "income") g.moneyIn += t.amountPence / 100;
    else g.moneyOut += -t.amountPence / 100;
    monthMap.set(m, g);
  });
  const monthly = [...monthMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, moneyIn: Math.round(m.moneyIn), moneyOut: Math.round(m.moneyOut) }));

  return { income, expenses, subscriptions, fees, accounts, classified: cls, months, monthly };
}
