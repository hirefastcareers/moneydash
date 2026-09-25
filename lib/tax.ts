/**
 * Self-assessment set-aside, worked out on profit rather than gross takings.
 * Tax and National Insurance are charged on profit (income minus allowable business costs),
 * so setting aside a % of gross over-reserves when the business has costs.
 */

/** Payee or row names you know are business costs, beyond anything categorised as business. e.g. ["MyBuilder"] */
export const EXTRA_BUSINESS_KEYWORDS: string[] = [];

type Row = { name: string; category?: string };

/** A dashboard row counts as a business cost if its category mentions business, it came from the Monzo business
 *  account, or its name matches EXTRA_BUSINESS_KEYWORDS. */
export function isBusinessCost(row: Row): boolean {
  if (/business/i.test(row.category ?? "")) return true;
  if (/\(monzo business\)/i.test(row.name)) return true;
  const name = row.name.toLowerCase();
  return EXTRA_BUSINESS_KEYWORDS.some((k) => k.trim() && name.includes(k.trim().toLowerCase()));
}

export function selfEmployedTax(opts: { seGrossMonthly: number; businessCostsMonthly: number; ratePct: number }) {
  const profit = Math.max(0, opts.seGrossMonthly - opts.businessCostsMonthly);
  return { profit, setAside: (profit * opts.ratePct) / 100 };
}
