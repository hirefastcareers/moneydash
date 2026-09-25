"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Camera, Download, Plus, RotateCcw, Trash2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnimatedNumber } from "@/components/fx/animated-number";
import { CashflowRiver, riverFromDashboard } from "@/components/fx/cashflow-river";
import { DebtFreePath } from "@/components/fx/debt-free-path";
import { GoalJar } from "@/components/fx/goal-jar";
import { SavingsGauge } from "@/components/fx/savings-gauge";
import { MonzoImport, type MonzoChange } from "@/components/monzo-import";
import { PageTitle } from "@/components/page-title";
import { SECTION_LABELS, useSection } from "@/components/section-nav";
import { Stat1 } from "@/components/stat-1";
import { Stat2 } from "@/components/stat-2";
import { DERIVED_PREFIX, deriveDashboard } from "@/lib/monzo/derive";
import { isBusinessCost, selfEmployedTax } from "@/lib/tax";
import type { TrackerConfig } from "@/lib/monzo/tracker";
import type { ImportReport, Rule, Txn } from "@/lib/monzo/types";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Freq = "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";
const FREQS: Freq[] = ["weekly", "fortnightly", "monthly", "quarterly", "yearly"];

type Income = { id: string; source: string; kind: string; amount: number; frequency: Freq };
type Expense = { id: string; name: string; category: string; amount: number; frequency: Freq; essential: boolean };
type Subscription = { id: string; name: string; amount: number; frequency: Freq; renews: string; worthIt: boolean };
type Fee = { id: string; name: string; amount: number; frequency: Freq; avoidable: boolean };
type Account = { id: string; name: string; type: string; balance: number };
type Investment = { id: string; name: string; platform: string; value: number; contributed: number; feePct: number };
type Debt = { id: string; name: string; balance: number; apr: number; minPayment: number };
type Goal = { id: string; name: string; target: number; saved: number; deadline: string };
type Snapshot = { date: string; netWorth: number; assets: number; debts: number };

type Data = {
  income: Income[];
  expenses: Expense[];
  subscriptions: Subscription[];
  fees: Fee[];
  accounts: Account[];
  investments: Investment[];
  debts: Debt[];
  goals: Goal[];
  snapshots: Snapshot[];
  settings: { taxRate: number };
  checklist: { week: string; done: string[] };
  completedWeeks: string[];
  /** Imported Monzo statement rows */
  transactions: Txn[];
  /** Payee overrides set on the Statements tab */
  rules: Rule[];
  /** One report per imported file */
  imports: ImportReport[];
  /** Rules learned from the budget tracker workbook */
  tracker: TrackerConfig | null;
};

const INCOME_KINDS = ["Employed (take-home)", "Self-employed (before tax)", "Other"];
const EXPENSE_CATEGORIES = ["Housing", "Bills", "Food", "Transport", "Insurance", "Personal", "Fun", "Business", "Other"];
const ACCOUNT_TYPES = ["Current", "Savings", "Cash ISA", "Tax pot", "Pension", "Cash", "Other"];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "finance-dashboard-v1";

const uid = () => Math.random().toString(36).slice(2, 10);

const gbpFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const gbp = (n: number) => gbpFmt.format(Number.isFinite(n) ? n : 0);
const pct = (n: number) => `${Number.isFinite(n) ? Math.round(n) : 0}%`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

function toMonthly(amount: number, f: Freq) {
  switch (f) {
    case "weekly":
      return (amount * 52) / 12;
    case "fortnightly":
      return (amount * 26) / 12;
    case "monthly":
      return amount;
    case "quarterly":
      return amount / 3;
    case "yearly":
      return amount / 12;
  }
}

function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function lastNWeeks(n: number) {
  const keys: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    keys.push(weekKey(d));
    d.setDate(d.getDate() - 7);
  }
  return keys;
}

function daysUntil(iso: string) {
  if (!iso) return Infinity;
  const target = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Sample data (clear it from the header once you've seen the layout)  */
/* ------------------------------------------------------------------ */

function inDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function sampleData(): Data {
  return {
    income: [
      { id: uid(), source: "Salary", kind: "Employed (take-home)", amount: 2000, frequency: "monthly" },
      { id: uid(), source: "Side business", kind: "Self-employed (before tax)", amount: 500, frequency: "monthly" },
    ],
    expenses: [
      { id: uid(), name: "Rent / mortgage", category: "Housing", amount: 750, frequency: "monthly", essential: true },
      { id: uid(), name: "Energy", category: "Bills", amount: 110, frequency: "monthly", essential: true },
      { id: uid(), name: "Council tax", category: "Bills", amount: 140, frequency: "monthly", essential: true },
      { id: uid(), name: "Groceries", category: "Food", amount: 70, frequency: "weekly", essential: true },
      { id: uid(), name: "Fuel", category: "Transport", amount: 35, frequency: "weekly", essential: true },
      { id: uid(), name: "Eating out", category: "Fun", amount: 90, frequency: "monthly", essential: false },
    ],
    subscriptions: [
      { id: uid(), name: "Phone contract", amount: 18, frequency: "monthly", renews: inDays(9), worthIt: true },
      { id: uid(), name: "Streaming", amount: 11, frequency: "monthly", renews: inDays(3), worthIt: false },
      { id: uid(), name: "Software tool", amount: 20, frequency: "monthly", renews: inDays(21), worthIt: true },
    ],
    fees: [
      { id: uid(), name: "Card payment fees (business)", amount: 6, frequency: "monthly", avoidable: false },
      { id: uid(), name: "Overdraft charge", amount: 8, frequency: "monthly", avoidable: true },
    ],
    accounts: [
      { id: uid(), name: "Everyday current account", type: "Current", balance: 850 },
      { id: uid(), name: "Easy-access savings", type: "Savings", balance: 1500 },
      { id: uid(), name: "Self-assessment pot", type: "Tax pot", balance: 600 },
      { id: uid(), name: "Workplace pension", type: "Pension", balance: 4200 },
    ],
    investments: [
      { id: uid(), name: "Global index fund", platform: "Stocks & Shares ISA", value: 1800, contributed: 1600, feePct: 0.45 },
    ],
    debts: [
      { id: uid(), name: "Credit card", balance: 1200, apr: 24.9, minPayment: 40 },
      { id: uid(), name: "Car finance", balance: 4800, apr: 8.9, minPayment: 190 },
    ],
    goals: [
      { id: uid(), name: "Emergency fund", target: 3000, saved: 1500, deadline: inDays(240) },
      { id: uid(), name: "New laptop", target: 1200, saved: 300, deadline: inDays(150) },
    ],
    snapshots: [],
    settings: { taxRate: 25 },
    checklist: { week: weekKey(), done: [] },
    completedWeeks: [],
    transactions: [],
    rules: [],
    imports: [],
    tracker: null,
  };
}

function emptyData(): Data {
  return {
    income: [],
    expenses: [],
    subscriptions: [],
    fees: [],
    accounts: [],
    investments: [],
    debts: [],
    goals: [],
    snapshots: [],
    settings: { taxRate: 25 },
    checklist: { week: weekKey(), done: [] },
    completedWeeks: [],
    transactions: [],
    rules: [],
    imports: [],
    tracker: null,
  };
}

/* ------------------------------------------------------------------ */
/* Monzo: fold statement-derived rows into the dashboard               */
/* ------------------------------------------------------------------ */

/** Replace previously derived rows, keep manual rows, and keep any flags the user changed on derived rows. */
function mergeDerived<T extends { id: string }>(existing: T[], derived: T[], keep: (keyof T)[]): T[] {
  const manual = existing.filter((r) => !r.id.startsWith(DERIVED_PREFIX));
  const prev = new Map(existing.map((r) => [r.id, r]));
  return [
    ...manual,
    ...derived.map((r) => {
      const p = prev.get(r.id);
      if (!p) return r;
      const merged = { ...r };
      keep.forEach((k) => {
        merged[k] = p[k];
      });
      return merged;
    }),
  ];
}

function applyDerived(d: Data): Data {
  const der = deriveDashboard(d.transactions, d.rules, d.tracker);
  return {
    ...d,
    income: mergeDerived<Income>(d.income, der.income, ["kind"]),
    expenses: mergeDerived<Expense>(d.expenses, der.expenses, ["essential"]),
    subscriptions: mergeDerived<Subscription>(d.subscriptions, der.subscriptions, ["worthIt"]),
    fees: mergeDerived<Fee>(d.fees, der.fees, ["avoidable"]),
    accounts: mergeDerived<Account>(d.accounts, der.accounts, ["type"]),
  };
}

/* ------------------------------------------------------------------ */
/* Routine content                                                     */
/* ------------------------------------------------------------------ */

const CHECKLIST: { id: string; mins: number; task: string }[] = [
  { id: "balance", mins: 2, task: "Check your current account balance and the bills leaving in the next 7 days." },
  { id: "scan", mins: 3, task: "Scan last week's transactions. Flag anything unexpected, duplicated or forgotten." },
  { id: "update", mins: 2, task: "Update the balances on the Balances tab (current, savings, credit cards)." },
  { id: "move", mins: 2, task: "Move money: goal transfers, plus a tax pot top-up from any self-employed income." },
  { id: "subs", mins: 2, task: "Look at subscriptions renewing in the next 14 days. Cancel anything you haven't used." },
  { id: "fees", mins: 1, task: "Check for new fees or charges (overdraft, late payment, card or platform fees)." },
  { id: "receipts", mins: 2, task: "File receipts and log business mileage or expenses for your tax return." },
  { id: "close", mins: 1, task: "Note one win and one thing to adjust next week. Then close the app until next week." },
];

const CADENCE: { period: string; why: string; items: string[] }[] = [
  {
    period: "Weekly",
    why: "Stay ahead of cash. Nothing strategic.",
    items: [
      "Current account balance vs. bills due in the next 7 days",
      "Spending in flexible categories (food, fun, fuel)",
      "Subscriptions renewing in the next 14 days",
      "Tax pot top-up from self-employed income",
      "Any new fees or charges",
    ],
  },
  {
    period: "Monthly",
    why: "Check the plan is working.",
    items: [
      "Savings rate (money left over ÷ income)",
      "Total spending by category vs. last month",
      "Debt balances and how much principal you paid off",
      "Net worth snapshot (press Log snapshot)",
      "Progress and required monthly amount for each goal",
      "Subscriptions audit: anything marked not worth it",
      "Fees and commissions paid this month",
    ],
  },
  {
    period: "Quarterly",
    why: "Change direction if needed.",
    items: [
      "Net worth trend across the last three snapshots",
      "Investment value vs. contributions, and platform fees as a %",
      "Debt strategy: highest-APR debt first, balance-transfer options",
      "Emergency fund in months of essential spending",
      "Goal deadlines: re-plan or re-prioritise",
      "Self-assessment: payments on account due 31 Jan and 31 Jul",
      "Pension contributions and any employer match",
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Editable table                                                      */
/* ------------------------------------------------------------------ */

type Col<T> = {
  key: keyof T & string;
  label: string;
  kind: "text" | "number" | "date" | "select" | "bool";
  options?: string[];
  className?: string;
};

function EditableTable<T extends { id: string }>({
  rows,
  cols,
  onChange,
  blank,
  addLabel,
  extra,
}: {
  rows: T[];
  cols: Col<T>[];
  onChange: (rows: T[]) => void;
  blank: () => T;
  addLabel: string;
  extra?: { label: string; render: (row: T) => ReactNode };
}) {
  const set = (id: string, key: keyof T, value: unknown) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)));

  const cell = (row: T, c: Col<T>) => {
    const v = row[c.key] as unknown;
    switch (c.kind) {
      case "number":
        return (
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            className="h-8 min-w-24"
            value={typeof v === "number" && Number.isFinite(v) ? v : 0}
            onChange={(e) => set(row.id, c.key, e.target.value === "" ? 0 : Number(e.target.value))}
          />
        );
      case "date":
        return (
          <Input
            type="date"
            className="h-8 min-w-36"
            value={String(v ?? "")}
            onChange={(e) => set(row.id, c.key, e.target.value)}
          />
        );
      case "select":
        return (
          <Select value={String(v)} onValueChange={(val) => set(row.id, c.key, val)}>
            <SelectTrigger className="h-8 min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(c.options ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "bool":
        return (
          <Checkbox
            aria-label={c.label}
            checked={Boolean(v)}
            onCheckedChange={(checked) => set(row.id, c.key, checked === true)}
          />
        );
      default:
        return (
          <Input
            className="h-8 min-w-40"
            value={String(v ?? "")}
            onChange={(e) => set(row.id, c.key, e.target.value)}
          />
        );
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead key={c.key} className={c.className}>
                  {c.label}
                </TableHead>
              ))}
              {extra && <TableHead className="text-right">{extra.label}</TableHead>}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={cols.length + (extra ? 2 : 1)} className="py-6 text-center text-muted-foreground">
                  Nothing here yet. Add your first one below.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                {cols.map((c) => (
                  <TableCell key={c.key} className={c.className}>
                    {cell(row, c)}
                  </TableCell>
                ))}
                {extra && <TableCell className="text-right tabular-nums">{extra.render(row)}</TableCell>}
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete row"
                    onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Button variant="outline" size="sm" onClick={() => onChange([...rows, blank()])}>
        <Plus className="size-4" /> {addLabel}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

const rise = (i: number): CSSProperties => ({ ["--i" as string]: i });

function Stat({
  label,
  value,
  hint,
  tone,
  className,
  style,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "good" | "bad";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Card className={`gap-1 py-4 ${className ?? ""}`} style={style}>
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <div
          className={`text-2xl font-semibold tabular-nums ${
            tone === "bad" ? "text-destructive" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : ""
          }`}
        >
          {value}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const tooltipStyle = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Page() {
  const [data, setData] = useState<Data>(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load once on the client
  useEffect(() => {
    // Hydrates dashboard state from this browser's storage. The setState is the point of the effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    let next: Data;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      next = raw ? { ...emptyData(), ...JSON.parse(raw) } : sampleData();
      next.transactions ??= [];
      next.rules ??= [];
      next.imports ??= [];
      next.tracker ??= null;
    } catch {
      next = sampleData();
    }
    if (next.checklist.week !== weekKey()) next.checklist = { week: weekKey(), done: [] };
    setData(next);
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Save on every change
  useEffect(() => {
    if (!loaded) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setSaveError(false);
    } catch {
      // Storage full or blocked: data stays in memory for this session
      setSaveError(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [data, loaded]);

  const patch = <K extends keyof Data>(key: K, value: Data[K]) => setData((d) => ({ ...d, [key]: value }));

  // Statement or rule changes rebuild the Monzo rows on every tab in one update
  const patchMonzo = (next: MonzoChange) =>
    setData((d) => {
      const merged: Data = { ...d, ...next };
      if (next.tracker !== undefined) {
        // Debts come from the tracker's Debt Tracker tab; rows you added yourself are kept
        const manual = d.debts.filter((x) => !x.id.startsWith("tracker-debt-"));
        const fromTracker: Debt[] = (next.tracker?.debts ?? []).map((td) => ({
          id: `tracker-debt-${td.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          name: td.lender && td.lender !== td.name ? `${td.name} (${td.lender})` : td.name,
          balance: td.balance,
          apr: td.apr,
          minPayment: td.payment,
        }));
        merged.debts = [...manual, ...fromTracker];
      }
      return applyDerived(merged);
    });

  const derived = useMemo(
    () => deriveDashboard(data.transactions, data.rules, data.tracker),
    [data.transactions, data.rules, data.tracker]
  );

  // Dashboard categories plus the budget tracker's exact category names
  const expenseCategories = useMemo(
    () => [
      ...new Set([
        ...EXPENSE_CATEGORIES,
        "Rent",
        ...(data.tracker?.categories.filter((c) => ["expense", "subscription", "fee"].includes(c.role)).map((c) => c.name) ?? []),
        ...data.expenses.map((e) => e.category),
      ]),
    ],
    [data.tracker, data.expenses]
  );

  /* ------------------------------ Numbers ------------------------------ */

  const m = useMemo(() => {
    const seGross = sum(data.income.filter((i) => i.kind.startsWith("Self")).map((i) => toMonthly(i.amount, i.frequency)));
    const otherIncome = sum(data.income.filter((i) => !i.kind.startsWith("Self")).map((i) => toMonthly(i.amount, i.frequency)));
    const businessCostsMonthly =
      sum(
        data.expenses
          .filter((e) => isBusinessCost({ name: e.name, category: e.category }))
          .map((e) => toMonthly(e.amount, e.frequency))
      ) +
      sum(data.subscriptions.filter((s) => isBusinessCost({ name: s.name })).map((s) => toMonthly(s.amount, s.frequency))) +
      sum(data.fees.filter((f) => isBusinessCost({ name: f.name })).map((f) => toMonthly(f.amount, f.frequency)));
    const { profit, setAside } = selfEmployedTax({
      seGrossMonthly: seGross,
      businessCostsMonthly,
      ratePct: data.settings.taxRate,
    });
    const taxSetAside = setAside;
    const incomeNet = otherIncome + seGross - taxSetAside;

    const expenses = sum(data.expenses.map((e) => toMonthly(e.amount, e.frequency)));
    const essential = sum(data.expenses.filter((e) => e.essential).map((e) => toMonthly(e.amount, e.frequency)));
    const subs = sum(data.subscriptions.map((s) => toMonthly(s.amount, s.frequency)));
    const subsNotWorth = sum(data.subscriptions.filter((s) => !s.worthIt).map((s) => toMonthly(s.amount, s.frequency)));
    const investFeesYear = sum(data.investments.map((i) => (i.value * i.feePct) / 100));
    const feesMonthly = sum(data.fees.map((f) => toMonthly(f.amount, f.frequency))) + investFeesYear / 12;
    const avoidableFees = sum(data.fees.filter((f) => f.avoidable).map((f) => toMonthly(f.amount, f.frequency)));
    const debtMin = sum(data.debts.map((d) => d.minPayment));

    const outgoings = expenses + subs + feesMonthly + debtMin;
    const leftOver = incomeNet - outgoings;
    const savingsRate = incomeNet > 0 ? (leftOver / incomeNet) * 100 : 0;

    const cashLike = sum(
      data.accounts.filter((a) => ["Current", "Savings", "Cash ISA", "Cash"].includes(a.type)).map((a) => a.balance)
    );
    const easyAccess = sum(data.accounts.filter((a) => ["Savings", "Cash ISA", "Cash"].includes(a.type)).map((a) => a.balance));
    const taxPot = sum(data.accounts.filter((a) => a.type === "Tax pot").map((a) => a.balance));
    const accountsTotal = sum(data.accounts.map((a) => a.balance));
    const investTotal = sum(data.investments.map((i) => i.value));
    const investContrib = sum(data.investments.map((i) => i.contributed));
    const assets = accountsTotal + investTotal;
    const debts = sum(data.debts.map((d) => d.balance));
    const netWorth = assets - debts;
    const emergencyMonths = essential + debtMin > 0 ? easyAccess / (essential + debtMin) : 0;
    const debtToIncome = incomeNet > 0 ? (debtMin / incomeNet) * 100 : 0;

    return {
      seGross, otherIncome, profit, taxSetAside, incomeNet, expenses, essential, subs, subsNotWorth,
      investFeesYear, feesMonthly, avoidableFees, debtMin, outgoings, leftOver, savingsRate,
      cashLike, easyAccess, taxPot, assets, debts, netWorth, investTotal, investContrib,
      emergencyMonths, debtToIncome,
    };
  }, [data]);

  const spendBreakdown = useMemo(() => {
    const byCat = new Map<string, number>();
    data.expenses.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + toMonthly(e.amount, e.frequency)));
    if (m.subs) byCat.set("Subscriptions", m.subs);
    if (m.feesMonthly) byCat.set("Fees", m.feesMonthly);
    if (m.debtMin) byCat.set("Debt payments", m.debtMin);
    return [...byCat.entries()]
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [data, m]);

  const renewals = data.subscriptions
    .map((s) => ({ ...s, days: daysUntil(s.renews) }))
    .filter((s) => s.days >= 0 && s.days <= 14)
    .sort((a, b) => a.days - b.days);

  const debtsByApr = [...data.debts].sort((a, b) => b.apr - a.apr);

  const signals: { text: string; tone: "good" | "warn" }[] = [];
  if (m.leftOver < 0) signals.push({ text: `You're spending ${gbp(-m.leftOver)} a month more than you bring in.`, tone: "warn" });
  if (m.emergencyMonths < 3)
    signals.push({ text: `Emergency fund covers ${m.emergencyMonths.toFixed(1)} months of essentials. Aim for 3–6.`, tone: "warn" });
  else signals.push({ text: `Emergency fund covers ${m.emergencyMonths.toFixed(1)} months of essentials.`, tone: "good" });
  if (debtsByApr[0] && debtsByApr[0].apr >= 15)
    signals.push({ text: `${debtsByApr[0].name} at ${debtsByApr[0].apr}% APR is your most expensive debt. Overpay this first.`, tone: "warn" });
  if (m.subsNotWorth > 0)
    signals.push({ text: `${gbp(m.subsNotWorth * 12)} a year on subscriptions you marked not worth it.`, tone: "warn" });
  if (m.avoidableFees > 0) signals.push({ text: `${gbp(m.avoidableFees * 12)} a year in avoidable fees.`, tone: "warn" });
  if (m.seGross > 0)
    signals.push({
      text: `Set aside ${gbp(m.taxSetAside)} a month for self-assessment. Tax pot holds ${gbp(m.taxPot)}.`,
      tone: m.taxPot >= m.taxSetAside * 3 ? "good" : "warn",
    });
  if (m.savingsRate >= 20) signals.push({ text: `Savings rate of ${pct(m.savingsRate)} — strong.`, tone: "good" });

  /* ------------------------------ Actions ------------------------------ */

  const logSnapshot = () => {
    const snap: Snapshot = { date: todayIso(), netWorth: Math.round(m.netWorth), assets: Math.round(m.assets), debts: Math.round(m.debts) };
    patch(
      "snapshots",
      [...data.snapshots.filter((s) => s.date !== snap.date), snap].sort((a, b) => a.date.localeCompare(b.date))
    );
  };

  const toggleTask = (id: string, checked: boolean) => {
    setData((d) => {
      const done = checked ? [...new Set([...d.checklist.done, id])] : d.checklist.done.filter((x) => x !== id);
      const allDone = CHECKLIST.every((t) => done.includes(t.id));
      const completedWeeks = allDone
        ? [...new Set([...d.completedWeeks, d.checklist.week])]
        : d.completedWeeks.filter((w) => w !== d.checklist.week);
      return { ...d, checklist: { ...d.checklist, done }, completedWeeks };
    });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finances-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      setData({ ...emptyData(), ...parsed });
    } catch {
      alert("That file isn't a valid export from this dashboard.");
    }
  };

  const clearAll = () => {
    if (confirm("Clear everything and start with an empty dashboard? Export first if you want a backup.")) setData(emptyData());
  };

  const { section } = useSection();

  if (!loaded) return <div className="p-8 text-muted-foreground">Loading your figures…</div>;

  const weeksShown = lastNWeeks(8);
  const weeksDone = weeksShown.filter((w) => data.completedWeeks.includes(w)).length;
  const minsDone = sum(CHECKLIST.filter((t) => data.checklist.done.includes(t.id)).map((t) => t.mins));

  /* ------------------------------ Render ------------------------------ */

  const fileActions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={exportJson}>
        <Download className="size-4" /> Export
      </Button>
      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
        <Upload className="size-4" /> Import
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importJson(f);
          e.target.value = "";
        }}
      />
      <Button variant="outline" size="sm" onClick={clearAll}>
        <RotateCcw className="size-4" /> Clear all
      </Button>
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTitle title={SECTION_LABELS[section]} endContent={fileActions} />

      {saveError && (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          This browser&apos;s storage is full, so changes won&apos;t survive a refresh. Export a backup now, then remove old imports on
          the Statements tab.
        </p>
      )}

        {/* ============================ OVERVIEW ============================ */}
        {section === "overview" && (
        <div className="space-y-4 sm:space-y-5">
          <p className="max-w-prose text-sm text-muted-foreground">
            {m.leftOver >= 0 ? (
              <>
                After every bill, subscription and debt payment you keep{" "}
                <span className="font-medium text-foreground">{gbp(m.leftOver)}</span> a month.
              </>
            ) : (
              <>
                You&apos;re <span className="font-medium text-destructive">{gbp(-m.leftOver)}</span> short each month. Open
                Cash flow in the sidebar.
              </>
            )}
          </p>
          <div className="grid gap-4 sm:gap-5 xl:grid-cols-4">
            <Stat2
              className="fx-rise"
              style={rise(0)}
              title="Net worth"
              value={<AnimatedNumber value={m.netWorth} format={gbp} />}
              trendValue={m.netWorth < 0 ? -1 : 1}
              trendLabel={m.netWorth < 0 ? "Negative" : "Positive"}
              footerLabel={`${gbp(m.assets)} in assets`}
              footerSubtext={`${gbp(m.debts)} in debts`}
            />
            <Stat2
              className="fx-rise"
              style={rise(1)}
              title="Income / month"
              value={<AnimatedNumber value={m.incomeNet} format={gbp} />}
              trendValue={m.incomeNet > 0 ? 1 : 0}
              trendLabel={m.seGross ? "After tax" : "Take-home"}
              footerLabel={
                m.seGross
                  ? `${gbp(m.taxSetAside)} set aside · ${data.settings.taxRate}% of ${gbp(m.profit)} profit`
                  : "No self-employed income"
              }
              footerSubtext="Employed pay is entered as take-home"
            />
            <Stat2
              className="fx-rise"
              style={rise(2)}
              title="Outgoings / month"
              value={<AnimatedNumber value={m.outgoings} format={gbp} />}
              trendValue={m.leftOver < 0 ? -1 : 1}
              trendLabel={m.leftOver < 0 ? "Over budget" : "Covered"}
              footerLabel={`${gbp(m.essential)} essential`}
              footerSubtext="Bills, subscriptions, fees and debt payments"
            />
            <Stat2
              className="fx-rise"
              style={rise(3)}
              title="Savings rate"
              value={<AnimatedNumber value={m.savingsRate} format={pct} />}
              aside={<SavingsGauge value={m.savingsRate} className="h-16 w-28" />}
              trendValue={m.savingsRate < 0 ? -1 : m.savingsRate >= 20 ? 1 : 0}
              trendLabel={m.savingsRate < 0 ? "Shortfall" : m.savingsRate >= 20 ? "Strong" : "Building"}
              footerLabel={`${gbp(m.leftOver)} left over`}
              footerSubtext="Money left after outgoings, divided by income"
            />
          </div>
          <div className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-4">
            <Stat1
              className="fx-rise"
              style={rise(4)}
              title="Total debt"
              value={<AnimatedNumber value={m.debts} format={gbp} />}
              changeValue={`${gbp(m.debtMin)}/mo minimums`}
              direction={m.debts > 0 ? "down" : "neutral"}
            />
            <Stat1
              className="fx-rise"
              style={rise(5)}
              title="Investments"
              value={<AnimatedNumber value={m.investTotal} format={gbp} />}
              changeValue={`${gbp(m.investTotal - m.investContrib)} growth`}
              direction={m.investTotal - m.investContrib < 0 ? "down" : "up"}
            />
            <Stat1
              className="fx-rise"
              style={rise(6)}
              title="Subscriptions"
              value={<AnimatedNumber value={m.subs} format={(n) => `${gbp(n)}/mo`} />}
              changeValue={`${gbp(m.subs * 12)} a year`}
              direction="neutral"
            />
            <Stat1
              className="fx-rise"
              style={rise(7)}
              title="Fees & commissions"
              value={<AnimatedNumber value={m.feesMonthly * 12} format={(n) => `${gbp(n)}/yr`} />}
              changeValue={`Incl. ${gbp(m.investFeesYear)} investment fees`}
              direction={m.avoidableFees > 0 ? "down" : "neutral"}
            />
          </div>

          <Card className="fx-rise" style={rise(8)}>
            <CardHeader>
              <CardTitle>Your month</CardTitle>
              <CardDescription>Where each pound comes from and goes. Hover a stream to focus it.</CardDescription>
            </CardHeader>
            <CardContent>
              <CashflowRiver
                {...riverFromDashboard({
                  income: data.income,
                  expenses: data.expenses,
                  subscriptions: data.subscriptions,
                  fees: data.fees,
                  debtPayments: m.debtMin,
                  taxSetAside: m.taxSetAside,
                  investmentFeesMonthly: m.investFeesYear / 12,
                })}
                format={gbp}
              />
            </CardContent>
          </Card>

          <Card className="fx-rise" style={rise(9)}>
            <CardHeader>
              <CardTitle>Your way out of debt</CardTitle>
              <CardDescription>
                Minimum payments on everything, with anything spare going to the highest interest rate first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DebtFreePath debts={data.debts} format={gbp} />
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:gap-5 xl:grid-cols-7">
            <Card className="fx-rise xl:col-span-3" style={rise(10)}>
              <CardHeader>
                <CardTitle>Where the money goes</CardTitle>
                <CardDescription>Monthly, by category</CardDescription>
              </CardHeader>
              <CardContent>
                {spendBreakdown.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Add expenses in Cash flow to see this.</p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={spendBreakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                            {spendBreakdown.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(v) => gbp(Number(v))} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="space-y-1.5 text-sm">
                      {spendBreakdown.map((s, i) => (
                        <li key={s.name} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            <span className="size-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                            {s.name}
                          </span>
                          <span className="tabular-nums text-muted-foreground">{gbp(s.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="fx-rise xl:col-span-4" style={rise(11)}>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div className="space-y-1.5">
                  <CardTitle>Net worth over time</CardTitle>
                  <CardDescription>Log a snapshot once a month</CardDescription>
                </div>
                <Button size="sm" onClick={logSnapshot}>
                  <Camera className="size-4" /> Log snapshot
                </Button>
              </CardHeader>
              <CardContent>
                {data.snapshots.length < 2 ? (
                  <p className="text-sm text-muted-foreground">
                    {data.snapshots.length === 0
                      ? "No snapshots yet. Log one today and again next month to start the line."
                      : `One snapshot logged (${data.snapshots[0].date}: ${gbp(data.snapshots[0].netWorth)}). Log another next month.`}
                  </p>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.snapshots} margin={{ left: 8, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                        <YAxis tickFormatter={(v) => gbp(Number(v))} tick={{ fontSize: 12 }} width={72} stroke="var(--muted-foreground)" />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => gbp(Number(v))} />
                        <Area type="monotone" dataKey="netWorth" name="Net worth" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="fx-rise" style={rise(12)}>
              <CardHeader>
                <CardTitle>Needs attention</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {signals.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <Badge variant={s.tone === "warn" ? "destructive" : "secondary"} className="mt-0.5 shrink-0">
                        {s.tone === "warn" ? "Act" : "OK"}
                      </Badge>
                      <span>{s.text}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="fx-rise" style={rise(13)}>
              <CardHeader>
                <CardTitle>Renewing in 14 days</CardTitle>
              </CardHeader>
              <CardContent>
                {renewals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing renews in the next two weeks.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {renewals.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <span>
                          {s.name}
                          {!s.worthIt && (
                            <Badge variant="outline" className="ml-2">
                              Cancel?
                            </Badge>
                          )}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {gbp(s.amount)} {s.days === 0 ? "today" : `in ${s.days}d`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="fx-rise" style={rise(14)}>
              <CardHeader>
                <CardTitle>Goals</CardTitle>
              </CardHeader>
              <CardContent>
                {data.goals.length === 0 && <p className="text-sm text-muted-foreground">Add a goal on the Goals tab.</p>}
                <div className="flex flex-wrap items-end gap-4">
                  {data.goals.map((g, i) => {
                    const p = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
                    return (
                      <div key={g.id} className="flex flex-col items-center gap-1">
                        <GoalJar pct={p} color={CHART_COLORS[i % CHART_COLORS.length]} />
                        <span className="max-w-24 text-center text-sm">{g.name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {gbp(g.saved)} / {gbp(g.target)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        )}

        {/* ============================ CASH FLOW ============================ */}
        {section === "cashflow" && (
        <div className="space-y-4 sm:space-y-5">
          <Card className="fx-rise" style={rise(0)}>
            <CardHeader>
              <CardTitle>Income</CardTitle>
              <CardDescription>
                Enter employed income as take-home. Enter self-employed income before tax; the dashboard sets aside tax for
                you.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <EditableTable<Income>
                rows={data.income}
                onChange={(r) => patch("income", r)}
                addLabel="Add income"
                blank={() => ({ id: uid(), source: "", kind: INCOME_KINDS[0], amount: 0, frequency: "monthly" })}
                cols={[
                  { key: "source", label: "Source", kind: "text" },
                  { key: "kind", label: "Type", kind: "select", options: INCOME_KINDS },
                  { key: "amount", label: "Amount", kind: "number" },
                  { key: "frequency", label: "How often", kind: "select", options: FREQS },
                ]}
                extra={{ label: "Per month", render: (r) => gbp(toMonthly(r.amount, r.frequency)) }}
              />
              <Separator />
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="tax">Tax set-aside for self-employed income (%)</Label>
                  <Input
                    id="tax"
                    type="number"
                    className="w-32"
                    value={data.settings.taxRate}
                    onChange={(e) => patch("settings", { ...data.settings, taxRate: Number(e.target.value) || 0 })}
                  />
                </div>
                <p className="max-w-prose text-sm text-muted-foreground">
                  Set aside from self-employed profit (income minus business costs). 25% is a rough rule of thumb, not a tax calculation.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="fx-rise" style={rise(1)}>
            <CardHeader>
              <CardTitle>Expenses</CardTitle>
              <CardDescription>Tick essential for anything you&apos;d still have to pay if money got tight.</CardDescription>
            </CardHeader>
            <CardContent>
              <EditableTable<Expense>
                rows={data.expenses}
                onChange={(r) => patch("expenses", r)}
                addLabel="Add expense"
                blank={() => ({ id: uid(), name: "", category: "Other", amount: 0, frequency: "monthly", essential: false })}
                cols={[
                  { key: "name", label: "Name", kind: "text" },
                  { key: "category", label: "Category", kind: "select", options: expenseCategories },
                  { key: "amount", label: "Amount", kind: "number" },
                  { key: "frequency", label: "How often", kind: "select", options: FREQS },
                  { key: "essential", label: "Essential", kind: "bool" },
                ]}
                extra={{ label: "Per month", render: (r) => gbp(toMonthly(r.amount, r.frequency)) }}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="fx-rise" style={rise(2)}>
              <CardHeader>
                <CardTitle>Subscriptions</CardTitle>
                <CardDescription>Untick &quot;Worth it&quot; to flag something for cancelling.</CardDescription>
              </CardHeader>
              <CardContent>
                <EditableTable<Subscription>
                  rows={data.subscriptions}
                  onChange={(r) => patch("subscriptions", r)}
                  addLabel="Add subscription"
                  blank={() => ({ id: uid(), name: "", amount: 0, frequency: "monthly", renews: "", worthIt: true })}
                  cols={[
                    { key: "name", label: "Name", kind: "text" },
                    { key: "amount", label: "Amount", kind: "number" },
                    { key: "frequency", label: "How often", kind: "select", options: FREQS },
                    { key: "renews", label: "Next renewal", kind: "date" },
                    { key: "worthIt", label: "Worth it", kind: "bool" },
                  ]}
                />
              </CardContent>
            </Card>

            <Card className="fx-rise" style={rise(3)}>
              <CardHeader>
                <CardTitle>Fees and commissions</CardTitle>
                <CardDescription>Bank, card, platform and late-payment charges. Investment fees are added automatically.</CardDescription>
              </CardHeader>
              <CardContent>
                <EditableTable<Fee>
                  rows={data.fees}
                  onChange={(r) => patch("fees", r)}
                  addLabel="Add fee"
                  blank={() => ({ id: uid(), name: "", amount: 0, frequency: "monthly", avoidable: false })}
                  cols={[
                    { key: "name", label: "Name", kind: "text" },
                    { key: "amount", label: "Amount", kind: "number" },
                    { key: "frequency", label: "How often", kind: "select", options: FREQS },
                    { key: "avoidable", label: "Avoidable", kind: "bool" },
                  ]}
                  extra={{ label: "Per year", render: (r) => gbp(toMonthly(r.amount, r.frequency) * 12) }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
        )}

        {/* ============================ BALANCES ============================ */}
        {section === "balances" && (
        <div className="space-y-4 sm:space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat className="fx-rise" style={rise(0)} label="Cash and current" value={<AnimatedNumber value={m.cashLike} format={gbp} />} />
            <Stat className="fx-rise" style={rise(1)} label="Tax pot" value={<AnimatedNumber value={m.taxPot} format={gbp} />} />
            <Stat className="fx-rise" style={rise(2)} label="Investments" value={<AnimatedNumber value={m.investTotal} format={gbp} />} />
            <Stat className="fx-rise" style={rise(3)} label="Debts" value={<AnimatedNumber value={m.debts} format={gbp} />} tone={m.debts > 0 ? "bad" : undefined} />
          </div>

          <Card className="fx-rise" style={rise(4)}>
            <CardHeader>
              <CardTitle>Accounts</CardTitle>
              <CardDescription>Use the Tax pot type for money saved towards your self-assessment bill.</CardDescription>
            </CardHeader>
            <CardContent>
              <EditableTable<Account>
                rows={data.accounts}
                onChange={(r) => patch("accounts", r)}
                addLabel="Add account"
                blank={() => ({ id: uid(), name: "", type: "Current", balance: 0 })}
                cols={[
                  { key: "name", label: "Name", kind: "text" },
                  { key: "type", label: "Type", kind: "select", options: ACCOUNT_TYPES },
                  { key: "balance", label: "Balance", kind: "number" },
                ]}
              />
            </CardContent>
          </Card>

          <Card className="fx-rise" style={rise(5)}>
            <CardHeader>
              <CardTitle>Investments</CardTitle>
              <CardDescription>Fee % is the yearly platform plus fund charge.</CardDescription>
            </CardHeader>
            <CardContent>
              <EditableTable<Investment>
                rows={data.investments}
                onChange={(r) => patch("investments", r)}
                addLabel="Add investment"
                blank={() => ({ id: uid(), name: "", platform: "", value: 0, contributed: 0, feePct: 0 })}
                cols={[
                  { key: "name", label: "Holding", kind: "text" },
                  { key: "platform", label: "Account / platform", kind: "text" },
                  { key: "value", label: "Value now", kind: "number" },
                  { key: "contributed", label: "Paid in", kind: "number" },
                  { key: "feePct", label: "Fee %", kind: "number" },
                ]}
                extra={{
                  label: "Gain",
                  render: (r) => {
                    const g = r.value - r.contributed;
                    return (
                      <span className={g < 0 ? "text-destructive" : ""}>
                        {gbp(g)} {r.contributed > 0 && `(${pct((g / r.contributed) * 100)})`}
                      </span>
                    );
                  },
                }}
              />
            </CardContent>
          </Card>

          <Card className="fx-rise" style={rise(6)}>
            <CardHeader>
              <CardTitle>Your way out of debt</CardTitle>
              <CardDescription>
                Minimum payments on everything, with anything spare going to the highest interest rate first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DebtFreePath debts={data.debts} format={gbp} />
            </CardContent>
          </Card>

          <Card className="fx-rise" style={rise(7)}>
            <CardHeader>
              <CardTitle>Debts</CardTitle>
              <CardDescription>
                Pay minimums on everything, then put any extra towards the highest APR first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EditableTable<Debt>
                rows={data.debts}
                onChange={(r) => patch("debts", r)}
                addLabel="Add debt"
                blank={() => ({ id: uid(), name: "", balance: 0, apr: 0, minPayment: 0 })}
                cols={[
                  { key: "name", label: "Name", kind: "text" },
                  { key: "balance", label: "Balance", kind: "number" },
                  { key: "apr", label: "APR %", kind: "number" },
                  { key: "minPayment", label: "Monthly payment", kind: "number" },
                ]}
                extra={{
                  label: "Payoff",
                  render: (r) => {
                    const monthlyInterest = (r.balance * r.apr) / 100 / 12;
                    const first = debtsByApr[0]?.id === r.id && data.debts.length > 1;
                    let text: string;
                    if (r.balance <= 0) text = "Paid off";
                    else if (r.minPayment <= monthlyInterest) text = "Never at this rate";
                    else {
                      const i = r.apr / 100 / 12;
                      const months =
                        i === 0 ? r.balance / r.minPayment : -Math.log(1 - (i * r.balance) / r.minPayment) / Math.log(1 + i);
                      text = `~${Math.ceil(months)} months`;
                    }
                    return (
                      <span className="inline-flex items-center gap-2">
                        {first && <Badge>Pay first</Badge>}
                        {text}
                      </span>
                    );
                  },
                }}
              />
            </CardContent>
          </Card>
        </div>
        )}

        {/* ============================ GOALS ============================ */}
        {section === "goals" && (
        <div className="space-y-4 sm:space-y-5">
          <Card className="fx-rise" style={rise(0)}>
            <CardHeader>
              <CardTitle>Financial goals</CardTitle>
              <CardDescription>The monthly figure is what you&apos;d need to save to hit each goal on time.</CardDescription>
            </CardHeader>
            <CardContent>
              <EditableTable<Goal>
                rows={data.goals}
                onChange={(r) => patch("goals", r)}
                addLabel="Add goal"
                blank={() => ({ id: uid(), name: "", target: 0, saved: 0, deadline: "" })}
                cols={[
                  { key: "name", label: "Goal", kind: "text" },
                  { key: "target", label: "Target", kind: "number" },
                  { key: "saved", label: "Saved so far", kind: "number" },
                  { key: "deadline", label: "Deadline", kind: "date" },
                ]}
                extra={{
                  label: "Needed / month",
                  render: (g) => {
                    const left = g.target - g.saved;
                    if (left <= 0) return <Badge variant="secondary">Done</Badge>;
                    if (!g.deadline) return "Set a deadline";
                    const months = daysUntil(g.deadline) / 30.44;
                    if (months <= 0) return <span className="text-destructive">Overdue</span>;
                    return gbp(left / Math.max(months, 1));
                  },
                }}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.goals.map((g, i) => {
              const p = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
              const months = g.deadline ? daysUntil(g.deadline) / 30.44 : 0;
              const needed = months > 0 ? (g.target - g.saved) / Math.max(months, 1) : 0;
              const affordable = needed <= 0 || needed <= Math.max(m.leftOver, 0);
              return (
                <Card key={g.id} className="fx-rise" style={rise(i + 1)}>
                  <CardHeader>
                    <CardTitle>{g.name || "Untitled goal"}</CardTitle>
                    <CardDescription>
                      {g.deadline ? `By ${new Date(g.deadline + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })}` : "No deadline"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-2xl font-semibold tabular-nums">{pct(p)}</div>
                    <GoalJar pct={p} color={CHART_COLORS[i % CHART_COLORS.length]} />
                    <p className="text-sm text-muted-foreground">
                      {gbp(g.saved)} of {gbp(g.target)}.{" "}
                      {needed > 0 &&
                        (affordable
                          ? `${gbp(needed)}/month keeps you on track.`
                          : `${gbp(needed)}/month needed — more than you have left over. Push the date back or cut elsewhere.`)}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
        )}

        {/* ============================ ROUTINE ============================ */}
        {section === "routine" && (
        <div className="space-y-4 sm:space-y-5">
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="fx-rise lg:col-span-3" style={rise(0)}>
              <CardHeader>
                <CardTitle>This week&apos;s 15-minute check-in</CardTitle>
                <CardDescription>
                  Same time each week, timer on. When it&apos;s ticked off, you&apos;re done until next week. Completed{" "}
                  {weeksDone} of the last 8 weeks.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span>{minsDone} of 15 minutes</span>
                    <span className="text-muted-foreground">{data.checklist.week}</span>
                  </div>
                  <Progress value={(minsDone / 15) * 100} />
                </div>
                <ul className="space-y-3">
                  {CHECKLIST.map((t) => {
                    const checked = data.checklist.done.includes(t.id);
                    return (
                      <li key={t.id} className="flex items-start gap-3">
                        <Checkbox
                          id={`task-${t.id}`}
                          checked={checked}
                          onCheckedChange={(c) => toggleTask(t.id, c === true)}
                          className="mt-0.5"
                        />
                        <Label
                          htmlFor={`task-${t.id}`}
                          className={`block flex-1 font-normal leading-snug ${checked ? "text-muted-foreground line-through" : ""}`}
                        >
                          {t.task}
                        </Label>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t.mins} min</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-sm text-muted-foreground">
                  Outside this slot, don&apos;t open banking apps to check balances. Automate savings and bill payments so the
                  weekly check is the only time you need to think about it.
                </p>
              </CardContent>
            </Card>

            <Card className="fx-rise lg:col-span-2" style={rise(1)}>
              <CardHeader>
                <CardTitle>Key dates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="font-medium">31 January:</span> self-assessment filing deadline, balancing payment and first
                  payment on account.
                </p>
                <p>
                  <span className="font-medium">31 July:</span> second payment on account.
                </p>
                <p>
                  <span className="font-medium">5 April:</span> tax year ends. Last chance to use this year&apos;s ISA allowance.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {CADENCE.map((c, i) => (
              <Card key={c.period} className="fx-rise" style={rise(i + 2)}>
                <CardHeader>
                  <CardTitle>{c.period}</CardTitle>
                  <CardDescription>{c.why}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1.5 pl-5 text-sm">
                    {c.items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
        )}

        {/* ============================ STATEMENTS ============================ */}
        {section === "statements" && (
          <MonzoImport
            transactions={data.transactions}
            rules={data.rules}
            imports={data.imports}
            tracker={data.tracker}
            derived={derived}
            categories={expenseCategories}
            onChange={patchMonzo}
          />
        )}
    </div>
  );
}
