"use client";

import { useEffect, useState } from "react";
import { AnimatedNumber } from "./animated-number";

/** Half-dial from -50% to +50% with a needle that springs to the savings rate. */
export function SavingsGauge({ value, className }: { value: number; className?: string }) {
  const clamped = Math.max(-50, Math.min(50, Number.isFinite(value) ? value : 0));
  const target = ((clamped + 50) / 100) * 180 - 90;
  const [angle, setAngle] = useState(-90);
  useEffect(() => {
    const t = requestAnimationFrame(() => setAngle(target));
    return () => cancelAnimationFrame(t);
  }, [target]);

  const arc = "M 20 100 A 80 80 0 0 1 180 100";
  return (
    <svg viewBox="0 0 200 128" className={className} role="img" aria-label={`Savings rate ${Math.round(value)}%`}>
      <defs>
        <linearGradient id="fx-gauge" x1="0" x2="1">
          <stop offset="0%" stopColor="#e11d48" />
          <stop offset="45%" stopColor="#f59e0b" />
          <stop offset="60%" stopColor="#84cc16" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <path d={arc} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={16} strokeLinecap="round" />
      <path d={arc} fill="none" stroke="url(#fx-gauge)" strokeWidth={10} strokeLinecap="round" pathLength={1} className="fx-draw" />
      {/* 0% tick */}
      <line x1={100} y1={14} x2={100} y2={26} stroke="currentColor" strokeOpacity={0.35} strokeWidth={2} />
      <g
        style={{
          transform: `rotate(${angle}deg)`,
          transformOrigin: "100px 100px",
          transition: "transform 1.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <path d="M 97 100 L 100 34 L 103 100 Z" fill="currentColor" />
      </g>
      <circle cx={100} cy={100} r={7} fill="currentColor" />
      <circle cx={100} cy={100} r={3} fill="var(--background, white)" />
      <text x={20} y={124} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.5}>
        −50%
      </text>
      <text x={180} y={124} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.5}>
        +50%
      </text>
    </svg>
  );
}

/** Same gauge with the number underneath. */
export function SavingsGaugeWithLabel({ value }: { value: number }) {
  return (
    <div className="flex flex-col items-center">
      <SavingsGauge value={value} className="w-40" />
      <AnimatedNumber
        value={value}
        format={(n) => `${Math.round(n)}%`}
        className={`-mt-1 text-lg font-semibold ${value < 0 ? "text-destructive" : value >= 20 ? "text-emerald-600 dark:text-emerald-400" : ""}`}
      />
    </div>
  );
}
