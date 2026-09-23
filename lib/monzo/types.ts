export type AccountKind = "personal" | "business";

export type TxnClass = "income" | "expense" | "subscription" | "fee" | "transfer" | "ignore";

export type Txn = {
  /** Monzo transaction ID for CSV rows, a stable hash for PDF rows */
  id: string;
  account: AccountKind;
  /** ISO date, yyyy-mm-dd */
  date: string;
  time?: string;
  /** Counterparty or merchant */
  name: string;
  description: string;
  /** Monzo's own category (CSV only) */
  monzoCategory?: string;
  /** Monzo transaction type, e.g. "Card payment", "Pot transfer" (CSV only) */
  type?: string;
  /** Whole pence. Negative = money out */
  amountPence: number;
  /** Running balance in pence (PDF only) */
  balancePence?: number;
  source: "csv" | "pdf";
  file: string;
  /** Where the row came from, e.g. "row 14" or "page 2, line 31" */
  where: string;
};

export type FailedLine = { where: string; raw: string; reason: string };

export type BalanceBreak = { where: string; raw: string; expectedPence: number; actualPence: number };

export type ImportReport = {
  id: string;
  file: string;
  account: AccountKind;
  format: "csv" | "pdf";
  importedAt: string;
  /** Transaction rows detected in the file */
  rowsFound: number;
  /** New rows added to the dashboard */
  imported: number;
  /** Rows already imported from an earlier upload */
  duplicates: number;
  failed: FailedLine[];
  from?: string;
  to?: string;
  warnings: string[];
  /** PDF only: every row checked against the running balance */
  reconciliation?: {
    ok: boolean;
    checked: number;
    openingPence?: number;
    closingPence?: number;
    breaks: BalanceBreak[];
  };
};

export type Rule = {
  id: string;
  /** Case-insensitive text matched against the name and description */
  match: string;
  class: TxnClass;
  /** Dashboard expense category, for expense rows */
  category?: string;
};

export type ParseResult = { txns: Txn[]; report: Omit<ImportReport, "imported" | "duplicates" | "id" | "importedAt"> };
