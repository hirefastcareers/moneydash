import Papa from "papaparse";
import { hash, parseMoneyToPence, parseUkDate } from "./common";
import type { AccountKind, FailedLine, ParseResult, Txn } from "./types";

const norm = (s: string) => s.replace(/^\uFEFF/, "").trim().toLowerCase();

/**
 * Parse a Monzo CSV export (personal or business).
 * Every data row either becomes a transaction or is listed in report.failed. Nothing is dropped silently.
 */
export function parseMonzoCsv(text: string, file: string, account: AccountKind): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: norm,
  });

  const failed: FailedLine[] = [];
  const txns: Txn[] = [];
  const fields = parsed.meta.fields ?? [];
  const has = (f: string) => fields.includes(f);

  // Papa-level problems (bad quotes, wrong column count) are reported, never skipped
  for (const e of parsed.errors) {
    failed.push({
      where: e.row !== undefined ? `row ${e.row + 2}` : "file",
      raw: e.row !== undefined ? JSON.stringify(parsed.data[e.row] ?? {}) : "",
      reason: `CSV format problem: ${e.message}`,
    });
  }

  if (!has("date") || !(has("amount") || has("money in") || has("money out"))) {
    return {
      txns: [],
      report: {
        file,
        account,
        format: "csv",
        rowsFound: parsed.data.length,
        failed: [
          {
            where: "header",
            raw: fields.join(","),
            reason: "This doesn't look like a Monzo CSV export: it needs Date and Amount (or Money in / Money out) columns.",
          },
        ],
        warnings: [],
      },
    };
  }

  const erroredRows = new Set(parsed.errors.map((e) => e.row).filter((r): r is number => r !== undefined));

  parsed.data.forEach((row, i) => {
    const where = `row ${i + 2}`; // +1 for header, +1 for 1-based
    if (erroredRows.has(i)) return; // already listed in failed
    const raw = Object.values(row).join(",");

    const date = parseUkDate(row["date"] ?? "");
    if (!date) {
      failed.push({ where, raw, reason: `Couldn't read the date "${row["date"] ?? ""}"` });
      return;
    }

    let amount: number | null = null;
    if (has("amount") && (row["amount"] ?? "").trim() !== "") amount = parseMoneyToPence(row["amount"]);
    if (amount === null && (has("money in") || has("money out"))) {
      const inn = parseMoneyToPence(row["money in"] || "0") ?? 0;
      const out = parseMoneyToPence(row["money out"] || "0") ?? 0;
      // Monzo shows money out as negative; accept either sign
      amount = inn - Math.abs(out);
    }
    if (amount === null) {
      failed.push({ where, raw, reason: `Couldn't read the amount "${row["amount"] ?? ""}"` });
      return;
    }

    const name = (row["name"] || row["description"] || row["type"] || "Unknown").trim();
    const txId = (row["transaction id"] ?? "").trim();

    txns.push({
      id: txId ? `${account}:${txId}` : `${account}:csv:${hash([date, row["time"], name, amount, i].join("|"))}`,
      account,
      date,
      time: row["time"]?.trim() || undefined,
      name,
      description: (row["description"] || row["notes and #tags"] || "").trim(),
      monzoCategory: row["category"]?.trim() || undefined,
      type: row["type"]?.trim() || undefined,
      amountPence: amount,
      source: "csv",
      file,
      where,
    });
  });

  const dates = txns.map((t) => t.date).sort();
  const accounted = txns.length + failed.filter((f) => f.where.startsWith("row")).length;
  const warnings: string[] = [];
  if (accounted !== parsed.data.length) {
    warnings.push(`Row count mismatch: ${parsed.data.length} rows in file, ${accounted} accounted for.`);
  }

  return {
    txns,
    report: {
      file,
      account,
      format: "csv",
      rowsFound: parsed.data.length,
      failed,
      from: dates[0],
      to: dates[dates.length - 1],
      warnings,
    },
  };
}
