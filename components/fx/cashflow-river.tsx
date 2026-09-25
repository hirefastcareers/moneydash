"use client";

import { useMemo, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

export type Flow = {
  label: string;
  /** Monthly amount in pounds, always positive */
  amount: number;
  tone?: "income" | "tax" | "debt" | "spend" | "left" | "short";
};

type Band = Flow & { y0: number; y1: number; color: string; labelY: number };

const W = 880;
const TOP = 34;
const USABLE = 340;
const GAP = 6;
const X_SRC = 190; // left bars
const X_NODE = 430; // centre node
const X_SINK = 670; // right bars
const BAR = 8;
const NODE = 18;

const SPEND_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-5)", "var(--chart-4)", "#0ea5e9", "#a855f7", "#f97316"];

function colorFor(f: Flow, i: number) {
  switch (f.tone) {
    case "income":
      return ["var(--chart-2)", "#14b8a6", "#22c55e", "#84cc16"][i % 4];
    case "tax":
      return "#f59e0b";
    case "debt":
      return "#e11d48";
    case "left":
      return "#10b981";
    case "short":
      return "var(--destructive)";
    default:
      return SPEND_COLORS[i % SPEND_COLORS.length];
  }
}

/** Space labels at least `min` apart, keeping them near their band. */
function spread(ys: number[], min: number, lo: number, hi: number) {
  const out = [...ys];
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + min);
  const overflow = out[out.length - 1] - hi;
  if (overflow > 0) for (let i = out.length - 1; i >= 0; i--) out[i] = Math.max(lo, out[i] - overflow);
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + min);
  return out;
}

function ribbon(x1: number, a0: number, a1: number, x2: number, b0: number, b1: number) {
  const mx = (x1 + x2) / 2;
  return `M${x1},${a0} C${mx},${a0} ${mx},${b0} ${x2},${b0} L${x2},${b1} C${mx},${b1} ${mx},${a1} ${x1},${a1} Z`;
}

function centreLine(x1: number, a: number, x2: number, b: number) {
  const mx = (x1 + x2) / 2;
  return `M${x1},${a} C${mx},${a} ${mx},${b} ${x2},${b}`;
}

/**
 * Income flows in from the left, through "your month", and out to where it goes on the right.
 * Any gap is shown honestly: a red "Shortfall" stream on the left, or a green "Left over" stream on the right.
 */
export function CashflowRiver({
  sources,
  sinks,
  format,
  maxSinks = 8,
}: {
  sources: Flow[];
  sinks: Flow[];
  format: (n: number) => string;
  maxSinks?: number;
}) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const src = sources.filter((s) => s.amount > 0.5).sort((a, b) => b.amount - a.amount);
    let out = sinks.filter((s) => s.amount > 0.5).sort((a, b) => b.amount - a.amount);
    if (out.length > maxSinks) {
      const rest = out.slice(maxSinks - 1).reduce((s, f) => s + f.amount, 0);
      out = [...out.slice(0, maxSinks - 1), { label: "Everything else", amount: rest, tone: "spend" }];
    }
    const inTotal = src.reduce((s, f) => s + f.amount, 0);
    const outTotal = out.reduce((s, f) => s + f.amount, 0);
    if (outTotal > inTotal + 0.5) src.push({ label: "Shortfall", amount: outTotal - inTotal, tone: "short" });
    if (inTotal > outTotal + 0.5) out.push({ label: "Left over", amount: inTotal - outTotal, tone: "left" });

    const total = Math.max(inTotal, outTotal, 1);
    const k = (USABLE - GAP * (Math.max(src.length, out.length) - 1)) / total;
    const nodeH = total * k;
    const nodeTop = TOP + (USABLE - nodeH) / 2;

    const stack = (flows: Flow[]): Band[] => {
      const h = flows.reduce((s, f) => s + f.amount * k, 0) + GAP * (flows.length - 1);
      let y = TOP + (USABLE - h) / 2;
      const bands = flows.map((f, i) => {
        const b = { ...f, y0: y, y1: y + Math.max(f.amount * k, 1.5), color: colorFor(f, i), labelY: 0 };
        y = b.y1 + GAP;
        return b;
      });
      const ys = spread(bands.map((b) => (b.y0 + b.y1) / 2), 34, TOP + 8, TOP + USABLE - 8);
      bands.forEach((b, i) => (b.labelY = ys[i]));
      return bands;
    };

    const left = stack(src);
    const right = stack(out);

    // Where each band meets the centre node (contiguous, no gaps)
    let ly = nodeTop;
    const leftNode = left.map((b) => {
      const h = b.amount * k;
      const seg = [ly, ly + h] as const;
      ly += h;
      return seg;
    });
    let ry = nodeTop;
    const rightNode = right.map((b) => {
      const h = b.amount * k;
      const seg = [ry, ry + h] as const;
      ry += h;
      return seg;
    });

    return { left, right, leftNode, rightNode, nodeTop, nodeH, total, inTotal, k };
  }, [sources, sinks, maxSinks]);

  const H = TOP + USABLE + 20;
  const dim = (label: string) => (hover && hover !== label ? 0.12 : 1);
  const particles = (amount: number) => Math.max(1, Math.min(4, Math.round((amount / layout.total) * 10)));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" role="img" aria-label="Money in and out each month">
        <defs>
          {[...layout.left, ...layout.right].map((b, i) => (
            <linearGradient key={i} id={`fx-river-${i}`} x1="0" x2="1">
              <stop offset="0%" stopColor={b.color} stopOpacity={0.55} />
              <stop offset="100%" stopColor={b.color} stopOpacity={0.25} />
            </linearGradient>
          ))}
        </defs>

        {/* Left: money in */}
        {layout.left.map((b, i) => {
          const [n0, n1] = layout.leftNode[i];
          const path = centreLine(X_SRC + BAR, (b.y0 + b.y1) / 2, X_NODE, (n0 + n1) / 2);
          const r = Math.max(1.5, Math.min(3.5, (b.y1 - b.y0) / 6));
          return (
            <g
              key={`l-${b.label}`}
              style={{ opacity: dim(b.label), transition: "opacity 200ms" }}
              onMouseEnter={() => setHover(b.label)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${b.label}: ${format(b.amount)} a month`}</title>
              <path
                d={ribbon(X_SRC + BAR, b.y0, b.y1, X_NODE, n0, n1)}
                fill={`url(#fx-river-${i})`}
                className={`fx-grow-x ${b.tone === "short" ? "fx-throb" : ""}`}
                style={{ ["--i" as string]: i }}
                strokeDasharray={b.tone === "short" ? "4 3" : undefined}
                stroke={b.tone === "short" ? b.color : undefined}
              />
              <rect x={X_SRC} y={b.y0} width={BAR} height={b.y1 - b.y0} rx={2} fill={b.color} className="fx-grow-y" />
              {!reduce &&
                Array.from({ length: particles(b.amount) }, (_, p) => (
                  <circle key={p} r={r} fill={b.color} opacity={0.9} visibility="hidden">
                    <set attributeName="visibility" to="visible" begin={`${(p / particles(b.amount)) * 3.2}s`} />
                    <animateMotion
                      dur="3.2s"
                      begin={`${(p / particles(b.amount)) * 3.2}s`}
                      repeatCount="indefinite"
                      path={path}
                    />
                  </circle>
                ))}
              <text x={X_SRC - 10} y={b.labelY - 3} textAnchor="end" fontSize={13} fontWeight={500} fill="currentColor">
                {b.label}
              </text>
              <text
                x={X_SRC - 10}
                y={b.labelY + 13}
                textAnchor="end"
                fontSize={12}
                fill={b.tone === "short" ? b.color : "currentColor"}
                opacity={b.tone === "short" ? 1 : 0.6}
              >
                {format(b.amount)}
              </text>
            </g>
          );
        })}

        {/* Right: money out */}
        {layout.right.map((b, i) => {
          const [n0, n1] = layout.rightNode[i];
          const gi = layout.left.length + i;
          const path = centreLine(X_NODE + NODE, (n0 + n1) / 2, X_SINK, (b.y0 + b.y1) / 2);
          const r = Math.max(1.5, Math.min(3.5, (b.y1 - b.y0) / 6));
          return (
            <g
              key={`r-${b.label}`}
              style={{ opacity: dim(b.label), transition: "opacity 200ms" }}
              onMouseEnter={() => setHover(b.label)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${b.label}: ${format(b.amount)} a month`}</title>
              <path
                d={ribbon(X_NODE + NODE, n0, n1, X_SINK, b.y0, b.y1)}
                fill={`url(#fx-river-${gi})`}
                className="fx-grow-x"
                style={{ ["--i" as string]: i + 3 }}
              />
              <rect x={X_SINK} y={b.y0} width={BAR} height={b.y1 - b.y0} rx={2} fill={b.color} className="fx-grow-y" />
              {!reduce &&
                Array.from({ length: particles(b.amount) }, (_, p) => (
                  <circle key={p} r={r} fill={b.color} opacity={0.9} visibility="hidden">
                    <set attributeName="visibility" to="visible" begin={`${1.6 + (p / particles(b.amount)) * 3.2}s`} />
                    <animateMotion
                      dur="3.2s"
                      begin={`${1.6 + (p / particles(b.amount)) * 3.2}s`}
                      repeatCount="indefinite"
                      path={path}
                    />
                  </circle>
                ))}
              <text x={X_SINK + BAR + 10} y={b.labelY - 3} fontSize={13} fontWeight={500} fill="currentColor">
                {b.label}
              </text>
              <text
                x={X_SINK + BAR + 10}
                y={b.labelY + 13}
                fontSize={12}
                fill={b.tone === "left" ? b.color : "currentColor"}
                opacity={b.tone === "left" ? 1 : 0.6}
              >
                {format(b.amount)}
              </text>
            </g>
          );
        })}

        {/* Centre: your month */}
        <rect
          x={X_NODE}
          y={layout.nodeTop}
          width={NODE}
          height={layout.nodeH}
          rx={5}
          fill="currentColor"
          opacity={0.85}
          className="fx-grow-y"
        />
        <text x={X_NODE + NODE / 2} y={layout.nodeTop - 12} textAnchor="middle" fontSize={12} fill="currentColor" opacity={0.6}>
          Your month
        </text>
        <text
          x={X_NODE + NODE / 2}
          y={layout.nodeTop + layout.nodeH + 20}
          textAnchor="middle"
          fontSize={13}
          fontWeight={600}
          fill="currentColor"
        >
          {format(layout.total)}
        </text>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helper: turn dashboard rows into river flows                         */
/* ------------------------------------------------------------------ */

type Freq = "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";
const perMonth = (amount: number, f: Freq) =>
  f === "weekly" ? (amount * 52) / 12 : f === "fortnightly" ? (amount * 26) / 12 : f === "quarterly" ? amount / 3 : f === "yearly" ? amount / 12 : amount;

/** Income rows go in on the left; tax set-aside, spending by category, subscriptions, fees and debt payments go out. */
export function riverFromDashboard(d: {
  income: { source: string; amount: number; frequency: Freq }[];
  expenses: { category: string; amount: number; frequency: Freq }[];
  subscriptions: { amount: number; frequency: Freq }[];
  fees: { amount: number; frequency: Freq }[];
  debtPayments: number;
  taxSetAside: number;
  investmentFeesMonthly?: number;
}): { sources: Flow[]; sinks: Flow[] } {
  const sources: Flow[] = d.income.map((i) => ({
    label: i.source.replace(/\s*\(Monzo (personal|business)\)$/i, "").replace(/^Income - /i, ""),
    amount: perMonth(i.amount, i.frequency),
    tone: "income",
  }));

  const byCat = new Map<string, number>();
  d.expenses.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + perMonth(e.amount, e.frequency)));
  const sinks: Flow[] = [...byCat.entries()].map(([label, amount]) => ({ label, amount, tone: "spend" as const }));

  const subs = d.subscriptions.reduce((s, r) => s + perMonth(r.amount, r.frequency), 0);
  const fees = d.fees.reduce((s, r) => s + perMonth(r.amount, r.frequency), 0) + (d.investmentFeesMonthly ?? 0);
  if (d.taxSetAside > 0) sinks.push({ label: "Tax pot", amount: d.taxSetAside, tone: "tax" });
  if (d.debtPayments > 0) sinks.push({ label: "Debt payments", amount: d.debtPayments, tone: "debt" });
  if (subs > 0) sinks.push({ label: "Subscriptions", amount: subs, tone: "spend" });
  if (fees > 0) sinks.push({ label: "Fees", amount: fees, tone: "spend" });
  return { sources, sinks };
}
