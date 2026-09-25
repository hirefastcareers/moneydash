"use client";

import { useMemo, useState } from "react";

type DebtIn = { name: string; balance: number; apr: number; minPayment: number };

type Sim = {
  series: { m: number; total: number }[];
  cleared: { name: string; m: number }[];
  months: number | null;
  interest: number;
};

/** Month-by-month payoff: minimums on everything, anything spare goes to the highest APR first (avalanche).
 *  When a debt clears, its payment rolls onto the next one. */
function simulate(debts: DebtIn[], extra: number): Sim {
  const ds = debts.filter((d) => d.balance > 0).map((d) => ({ ...d, done: false }));
  const budget = ds.reduce((s, d) => s + d.minPayment, 0) + extra;
  let total = ds.reduce((s, d) => s + d.balance, 0);
  const series = [{ m: 0, total }];
  const cleared: Sim["cleared"] = [];
  let interest = 0;

  for (let m = 1; m <= 600 && total > 0.005; m++) {
    for (const d of ds) {
      if (d.done) continue;
      const i = (d.balance * d.apr) / 1200;
      d.balance += i;
      interest += i;
    }
    let pool = budget;
    for (const d of ds) {
      if (d.done) continue;
      const p = Math.min(d.minPayment, d.balance, pool);
      d.balance -= p;
      pool -= p;
    }
    const order = ds.filter((d) => !d.done && d.balance > 0.005).sort((a, b) => b.apr - a.apr || a.balance - b.balance);
    for (const d of order) {
      if (pool <= 0) break;
      const p = Math.min(pool, d.balance);
      d.balance -= p;
      pool -= p;
    }
    for (const d of ds) {
      if (!d.done && d.balance <= 0.005) {
        d.done = true;
        d.balance = 0;
        cleared.push({ name: d.name, m });
      }
    }
    total = ds.reduce((s, d) => s + d.balance, 0);
    series.push({ m, total });
  }
  return { series, cleared, months: total <= 0.005 ? series[series.length - 1].m : null, interest };
}

const monthLabel = (m: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + m);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};

const W = 880;
const H = 280;
const PAD = { l: 64, r: 110, t: 30, b: 34 };

/**
 * The way out: total debt falling month by month to a finish flag, with a pin where each debt clears.
 * The slider shows what paying a bit extra each month does to the date and the interest.
 */
export function DebtFreePath({ debts, format }: { debts: DebtIn[]; format: (n: number) => string }) {
  const [extra, setExtra] = useState(0);
  const base = useMemo(() => simulate(debts, 0), [debts]);
  const sim = useMemo(() => simulate(debts, extra), [debts, extra]);

  const start = sim.series[0]?.total ?? 0;
  if (start <= 0) {
    return <p className="text-sm text-muted-foreground">No debts to pay off. That&apos;s the finish line already.</p>;
  }

  // Keep the x-axis fixed to the no-extra plan so the slider visibly pulls the flag closer
  const span = Math.min(base.months ?? 600, 600);
  const x = (m: number) => PAD.l + (m / span) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / start) * (H - PAD.t - PAD.b);
  const shown = sim.series.filter((p) => p.m <= span);
  const line = shown.map((p, i) => `${i ? "L" : "M"}${x(p.m).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
  const last = shown[shown.length - 1];
  const area = `${line} L${x(last.m).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`;

  // Label every pin that has room; the rest keep a tooltip
  let lastLabelX = -Infinity;
  const pins = sim.cleared
    .filter((c) => c.m <= span)
    .map((c, i) => {
      const px = x(c.m);
      // The finish flag labels the last debt, so its pin stays unlabelled
      const show = px - lastLabelX > 70 && c.m !== sim.months;
      if (show) lastLabelX = px;
      const py = y(sim.series[c.m]?.total ?? 0);
      // Alternate labels above and below the line, but never above the top of the chart
      return { ...c, px, py, show, above: i % 2 === 0 && py - 32 > PAD.t };
    });

  const years = Array.from({ length: Math.floor(span / 12) + 1 }, (_, i) => i * 12).filter((m) => m > 0);
  const saved = base.months && sim.months ? base.months - sim.months : 0;
  const interestSaved = base.interest - sim.interest;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" role="img" aria-label="Debt payoff path">
          <defs>
            <linearGradient id="fx-debt-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* Grid */}
          {[1, 0.5, 0].map((f) => (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(start * f)} y2={y(start * f)} stroke="currentColor" opacity={0.1} />
              <text x={PAD.l - 8} y={y(start * f) + 4} textAnchor="end" fontSize={11} fill="currentColor" opacity={0.55}>
                {format(start * f)}
              </text>
            </g>
          ))}
          {years.map((m) => (
            <text key={m} x={x(m)} y={H - 10} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.55}>
              {monthLabel(m).split(" ")[1]}
            </text>
          ))}
          <text x={x(0)} y={H - 10} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.55}>
            Now
          </text>

          {/* The path down */}
          <path d={area} fill="url(#fx-debt-fill)" className="fx-fade" style={{ ["--delay" as string]: "0.6s" }} />
          <path
            key={sim.months ?? "never"}
            d={line}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="fx-draw"
          />

          {/* A pin for each debt cleared */}
          {pins.map((p) => (
            <g key={p.name} className="fx-pop" style={{ ["--delay" as string]: `${0.3 + (1.3 * p.m) / span}s` }}>
              <title>{`${p.name} cleared ${monthLabel(p.m)}`}</title>
              <circle cx={p.px} cy={p.py} r={6} fill="var(--background, white)" stroke="#10b981" strokeWidth={2.5} />
              <path d={`M${p.px - 2.5},${p.py} l1.8,1.8 l3.4,-3.6`} fill="none" stroke="#10b981" strokeWidth={1.6} strokeLinecap="round" />
              {p.show && (
                <text
                  x={p.px}
                  y={p.above ? p.py - 14 : p.py + 22}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={500}
                  fill="currentColor"
                >
                  {p.name}
                  <tspan x={p.px} dy={12} fontWeight={400} opacity={0.6}>
                    {monthLabel(p.m)}
                  </tspan>
                </text>
              )}
            </g>
          ))}

          {/* Finish flag */}
          {sim.months !== null && sim.months <= span && (
            <g className="fx-pop" style={{ ["--delay" as string]: "1.6s" }}>
              <line x1={x(sim.months)} x2={x(sim.months)} y1={y(0)} y2={y(0) - 46} stroke="currentColor" strokeWidth={2} />
              <path
                d={`M${x(sim.months)},${y(0) - 46} h26 l-6,8 l6,8 h-26 z`}
                fill="#10b981"
                className="fx-flag"
              />
              <text x={x(sim.months) + 8} y={y(0) - 56} fontSize={12} fontWeight={600} fill="currentColor">
                Debt-free
                <tspan x={x(sim.months) + 8} dy={-14} fontWeight={400} opacity={0.7}>
                  {monthLabel(sim.months)}
                </tspan>
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-3">
          <span className="whitespace-nowrap">Pay extra each month</span>
          <input
            type="range"
            min={0}
            max={500}
            step={10}
            value={extra}
            onChange={(e) => setExtra(Number(e.target.value))}
            className="w-40 accent-[var(--chart-1)]"
          />
          <span className="w-14 font-medium tabular-nums">{format(extra)}</span>
        </label>
        <p className="text-muted-foreground">
          {sim.months === null ? (
            <span className="text-destructive">At these payments the interest outpaces the repayments, so the balance never clears.</span>
          ) : extra === 0 ? (
            <>
              Debt-free by <span className="font-medium text-foreground">{monthLabel(sim.months)}</span>, paying{" "}
              {format(sim.interest)} in interest along the way.
            </>
          ) : (
            <>
              Debt-free by <span className="font-medium text-foreground">{monthLabel(sim.months)}</span>
              {saved > 0 && <>, {saved} months sooner</>}, saving{" "}
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{format(interestSaved)}</span> in interest.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
