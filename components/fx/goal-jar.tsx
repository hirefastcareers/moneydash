"use client";

import { useEffect, useId, useState } from "react";
import { AnimatedNumber } from "./animated-number";

const BODY = "M14,24 Q14,18 20,18 H60 Q66,18 66,24 V88 Q66,96 58,96 H22 Q14,96 14,88 Z";
const TOP = 20; // water surface at 100%
const BOTTOM = 96; // water surface at 0%

/** A jar that fills to the goal's progress, with a moving waterline and a few bubbles. */
export function GoalJar({ pct, color = "var(--chart-1)", className }: { pct: number; color?: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const [level, setLevel] = useState(BOTTOM);
  useEffect(() => {
    const t = requestAnimationFrame(() => setLevel(BOTTOM - (p / 100) * (BOTTOM - TOP)));
    return () => cancelAnimationFrame(t);
  }, [p]);

  // Two wave periods wide so translating by one period loops seamlessly
  const wave = (amp: number) =>
    `M0,0 ${Array.from({ length: 6 }, (_, i) => `Q${i * 40 + 10},${-amp} ${i * 40 + 20},0 T${i * 40 + 40},0`).join(" ")} V120 H0 Z`;

  return (
    <div className={`flex flex-col items-center ${className ?? ""}`}>
      <svg viewBox="0 0 80 104" className="w-20" role="img" aria-label={`${Math.round(p)}% saved`}>
        <defs>
          <clipPath id={`jar-${id}`}>
            <path d={BODY} />
          </clipPath>
        </defs>
        {/* lid */}
        <rect x={22} y={8} width={36} height={9} rx={2.5} fill="currentColor" opacity={0.25} />
        <g clipPath={`url(#jar-${id})`}>
          <rect x={0} y={0} width={80} height={104} fill="currentColor" opacity={0.04} />
          <g style={{ transform: `translateY(${level}px)`, transition: "transform 1.4s cubic-bezier(0.2, 0.7, 0.2, 1)" }}>
            <path d={wave(4)} fill={color} opacity={0.35} className="fx-wave" style={{ ["--speed" as string]: "4.5s" }} />
            <path d={wave(3)} fill={color} opacity={0.75} className="fx-wave" style={{ ["--speed" as string]: "2.8s" }} transform="translate(-20,3)" />
            {p > 5 &&
              [18, 34, 52].map((cx, i) => (
                <circle
                  key={cx}
                  cx={cx}
                  cy={BOTTOM - level - 4}
                  r={1.8}
                  fill="white"
                  className="fx-bubble"
                  style={{
                    ["--delay" as string]: `${i * 0.9}s`,
                    ["--speed" as string]: `${2.6 + i * 0.5}s`,
                    ["--rise" as string]: `${Math.max(0, BOTTOM - level - 8)}px`,
                  }}
                />
              ))}
          </g>
        </g>
        <path d={BODY} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={2} />
        {/* glass shine */}
        <path d="M22,30 V80" stroke="white" strokeOpacity={0.5} strokeWidth={3} strokeLinecap="round" />
      </svg>
      <AnimatedNumber value={p} format={(n) => `${Math.round(n)}%`} className="text-sm font-semibold" />
    </div>
  );
}
