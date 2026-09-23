import { MONEY_TOKEN, hash, leadingDate, parseMoneyToPence } from "./common";
import type { AccountKind, BalanceBreak, FailedLine, ParseResult, Txn } from "./types";

export type TextItem = { str: string; x: number; y: number; w: number };
export type PageText = { width: number; items: TextItem[] };

type Line = { page: number; index: number; y: number; items: TextItem[]; text: string };

/* ------------------------------------------------------------------ */
/* 1. Extract positioned text from the PDF (browser)                   */
/* ------------------------------------------------------------------ */

export async function extractPdfPages(data: ArrayBuffer): Promise<PageText[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width });
    }
    pages.push({ width: viewport.width, items });
  }
  return pages;
}

/* ------------------------------------------------------------------ */
/* 2. Rebuild rows from x/y positions (not from line breaks)           */
/* ------------------------------------------------------------------ */

function toLines(page: PageText, pageNo: number): Line[] {
  // Split multi-token items so each money value is its own token
  const items: TextItem[] = [];
  for (const it of page.items) {
    const parts = it.str.trim().split(/\s{2,}/);
    if (parts.length === 1) {
      items.push({ ...it, str: it.str.trim() });
      continue;
    }
    const step = it.w / parts.length;
    parts.forEach((s, i) => items.push({ str: s, x: it.x + step * i, y: it.y, w: step }));
  }

  // Group by baseline (PDF y grows upwards)
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextItem[][] = [];
  // Monzo puts the merchant about 7pt above the date on the same payment.
  const TOL = 7;
  for (const it of items) {
    const g = groups.find((grp) => Math.abs(grp[0].y - it.y) <= TOL);
    if (g) g.push(it);
    else groups.push([it]);
  }
  groups.sort((a, b) => b[0].y - a[0].y);

  return groups.map((g, i) => {
    g.sort((a, b) => a.x - b.x);
    return { page: pageNo, index: i + 1, y: g[0].y, items: g, text: g.map((t) => t.str).join(" ").replace(/\s+/g, " ").trim() };
  });
}

/* ------------------------------------------------------------------ */
/* 3. Turn rows into transactions, then prove none are missing          */
/* ------------------------------------------------------------------ */

type Pending = {
  date: string;
  desc: string[];
  money: { pence: number; x: number; raw: string }[];
  lines: Line[];
  lastY: number;
};

export function parseStatementPages(pages: PageText[], file: string, account: AccountKind): ParseResult {
  const failed: FailedLine[] = [];
  const warnings: string[] = [];
  const rows: { date: string; desc: string; amount: number; balance: number; where: string; raw: string }[] = [];
  let openingPence: number | undefined;
  let closingPence: number | undefined;

  let pending: Pending | null = null;
  let lineHeight = 12;

  const locate = (l: Line) => `page ${l.page}, line ${l.index}`;

  const finish = () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    const where = locate(p.lines[0]);
    const raw = p.lines.map((l) => l.text).join(" / ");
    if (p.money.length < 2) {
      failed.push({ where, raw, reason: "Found a date but not both an amount and a balance on this row." });
      return;
    }
    if (p.money.length > 2) {
      failed.push({ where, raw, reason: `Found ${p.money.length} money values on this row; expected amount and balance.` });
      return;
    }
    const [amt, bal] = [...p.money].sort((a, b) => a.x - b.x);
    rows.push({ date: p.date, desc: p.desc.join(" ").replace(/\s+/g, " ").trim(), amount: amt.pence, balance: bal.pence, where, raw });
  };

  pages.forEach((page, pi) => {
    const lines = toLines(page, pi + 1);
    // Money column starts where the header says "Amount", or right of 55% of the page
    const header = lines.find((l) => /\bdate\b/i.test(l.text) && /\bbalance\b/i.test(l.text));
    const amountHeader = header?.items.find((t) => /amount|paid out|money out|debit/i.test(t.str));
    const moneyStartX = amountHeader ? amountHeader.x - 40 : page.width * 0.55;
    let inTable = !header; // no header on this page: rely on date detection alone

    const ys = lines.map((l) => l.y);
    const gaps = ys.slice(1).map((y, i) => ys[i] - y).filter((g) => g > 4 && g < 40).sort((a, b) => a - b);
    if (gaps.length) lineHeight = gaps[Math.floor(gaps.length / 2)];

    for (const line of lines) {
      if (header && line === header) {
        finish();
        inTable = true;
        continue;
      }

      const moneyItems = line.items.filter((t) => t.x + t.w >= moneyStartX && MONEY_TOKEN.test(t.str.replace(/\s/g, "")));
      const money = moneyItems.map((t) => ({ pence: parseMoneyToPence(t.str)!, x: t.x + t.w, raw: t.str }));
      const textPart = line.items.filter((t) => !moneyItems.includes(t)).map((t) => t.str).join(" ").replace(/\s+/g, " ").trim();

      // Opening / closing balance lines
      if (/(opening|start(ing)?|brought forward)\s*balance|balance brought forward/i.test(line.text) && money.length) {
        finish();
        openingPence ??= money[money.length - 1].pence;
        continue;
      }
      if (/(closing|end(ing)?|carried forward)\s*balance|balance carried forward/i.test(line.text) && money.length) {
        finish();
        closingPence = money[money.length - 1].pence;
        continue;
      }

      const dated = leadingDate(textPart);
      // Monzo prints the statement period ("01/04/2025 - 11/04/2025") above the table.
      // It is not a transaction; treating it as one swallows the summary balances.
      if (
        dated &&
        !money.length &&
        /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\s*[-–—]\s*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(textPart)
      ) {
        continue;
      }
      if (dated) {
        finish();
        pending = { date: dated.date, desc: dated.rest ? [dated.rest] : [], money: [...money], lines: [line], lastY: line.y };
        inTable = true;
        continue;
      }

      const current = pending as Pending | null;
      // Wrapped description lines sit ~7–14pt under the date. The next payment and the
      // legal footer start further down, so don't treat those as the same row.
      const close = current && current.lastY - line.y <= Math.min(lineHeight * 2.2, 20);
      if (current && close) {
        // Continuation of the row: extra description text, or the amounts sitting on a wrapped line
        if (textPart) current.desc.push(textPart);
        current.money.push(...money);
        current.lines.push(line);
        current.lastY = line.y;
        continue;
      }

      finish();
      if (inTable && money.length) {
        failed.push({ where: locate(line), raw: line.text, reason: "Money values with no date. Possibly a row the parser couldn't match." });
      }
    }
    finish(); // rows don't carry over page breaks
  });

  /* ---------------------- Reconciliation ---------------------- */

  // Statements can run oldest-first or newest-first. Score both and use the better one.
  const score = (asc: boolean) => {
    let ok = 0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (asc ? prev.balance + cur.amount === cur.balance : cur.balance + prev.amount === prev.balance) ok++;
      else if (asc ? prev.balance - cur.amount === cur.balance : cur.balance - prev.amount === prev.balance) ok++;
    }
    return ok;
  };
  const ascending = score(true) >= score(false);
  const ordered = ascending ? rows : [...rows].reverse();
  if (!ascending) warnings.push("Statement lists newest transactions first; order was reversed for checking.");

  const breaks: BalanceBreak[] = [];
  let signFlips = 0;
  let prevBal = openingPence;
  for (const r of ordered) {
    if (prevBal !== undefined) {
      if (prevBal + r.amount !== r.balance) {
        if (prevBal - r.amount === r.balance) {
          r.amount = -r.amount; // unsigned amount column: sign recovered from the balance
          signFlips++;
        } else {
          breaks.push({ where: r.where, raw: r.raw, expectedPence: prevBal + r.amount, actualPence: r.balance });
        }
      }
    }
    prevBal = r.balance;
  }
  if (signFlips) warnings.push(`${signFlips} amounts had no +/- sign; direction was taken from the running balance.`);
  if (closingPence !== undefined && ordered.length && ordered[ordered.length - 1].balance !== closingPence) {
    const last = ordered[ordered.length - 1];
    breaks.push({ where: "closing balance", raw: last.raw, expectedPence: closingPence, actualPence: last.balance });
  }
  if (openingPence === undefined && ordered.length) {
    warnings.push("No opening balance found, so the first row can't be checked on its own. Every row after it is checked.");
  }

  const txns: Txn[] = ordered.map((r) => ({
    id: `${account}:pdf:${hash([r.date, r.desc, r.amount, r.balance].join("|"))}`,
    account,
    date: r.date,
    name: cleanName(r.desc),
    description: r.desc,
    amountPence: r.amount,
    balancePence: r.balance,
    source: "pdf",
    file,
    where: r.where,
  }));

  const dates = txns.map((t) => t.date).sort();
  return {
    txns,
    report: {
      file,
      account,
      format: "pdf",
      rowsFound: rows.length + failed.length,
      failed,
      from: dates[0],
      to: dates[dates.length - 1],
      warnings,
      reconciliation: {
        ok: breaks.length === 0 && failed.length === 0 && rows.length > 0,
        checked: Math.max(0, ordered.length - (openingPence === undefined ? 1 : 0)),
        openingPence,
        closingPence,
        breaks,
      },
    },
  };
}

/** First meaningful chunk of a description, used to group the same merchant together. */
function cleanName(desc: string) {
  return (
    desc
      .replace(/\b(card payment|faster payment|direct debit|standing order|bacs|to|from)\b/gi, " ")
      .replace(/\b\d{4,}\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 4)
      .join(" ") || desc.slice(0, 40)
  );
}
