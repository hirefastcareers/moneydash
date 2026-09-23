/** Parse a money string to whole pence without floating-point error. Returns null if it isn't money. */
export function parseMoneyToPence(raw: string): number | null {
  let s = raw.trim().replace(/[£,\s]/g, "").replace(/[\u2212\u2013\u2014]/g, "-");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/CR$/i.test(s)) s = s.slice(0, -2);
  else if (/DR$/i.test(s)) {
    neg = !neg;
    s = s.slice(0, -2);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("£")) s = s.slice(1);
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const pence = parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2].padEnd(2, "0"), 10) : 0);
  return neg ? -pence : pence;
}

/** Strict money token for PDF columns: must have exactly two decimal places. */
export const MONEY_TOKEN = /^[-\u2212+]?£?-?\d{1,3}(,\d{3})*\.\d{2}$|^[-\u2212+]?£?-?\d+\.\d{2}$|^\(£?[\d,]+\.\d{2}\)$/;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Accepts DD/MM/YYYY, DD-MM-YYYY, DD.MM.YY, YYYY-MM-DD and "21 Sep 2026". Returns ISO yyyy-mm-dd or null. */
export function parseUkDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    return iso(y, parseInt(m[2], 10), parseInt(m[1], 10));
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (!mon) return null;
    return iso(parseInt(m[3], 10), mon, parseInt(m[1], 10));
  }
  return null;
}

/** Date at the start of a line of text. Returns the ISO date and the rest of the line. */
export function leadingDate(text: string): { date: string; rest: string } | null {
  const m = /^\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?\s+\d{4})\b\s*(.*)$/.exec(text);
  if (!m) return null;
  const date = parseUkDate(m[1]);
  return date ? { date, rest: m[2] } : null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Small, stable, non-cryptographic hash (FNV-1a) for de-duplication ids. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const penceToPounds = (p: number) => p / 100;

export function formatPence(p: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(p / 100);
}
