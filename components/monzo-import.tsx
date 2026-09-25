"use client";

import { useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileSpreadsheet, FileUp, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { formatPence } from "@/lib/monzo/common";
import { normName, type Derived } from "@/lib/monzo/derive";
import { parseMonzoCsv } from "@/lib/monzo/parse-csv";
import { extractPdfPages, parseStatementPages } from "@/lib/monzo/parse-pdf";
import { parseTrackerWorkbook, type TrackerConfig } from "@/lib/monzo/tracker";
import type { AccountKind, ImportReport, ParseResult, Rule, Txn, TxnClass } from "@/lib/monzo/types";

const CLASSES: { value: TxnClass; label: string }[] = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "subscription", label: "Subscription" },
  { value: "fee", label: "Fee" },
  { value: "debt", label: "Debt repayment" },
  { value: "transfer", label: "Own transfer" },
  { value: "ignore", label: "Ignore" },
];

const uid = () => Math.random().toString(36).slice(2, 10);

const tooltipStyle = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

export type MonzoChange = {
  transactions?: Txn[];
  rules?: Rule[];
  imports?: ImportReport[];
  tracker?: TrackerConfig | null;
};

type Props = {
  transactions: Txn[];
  rules: Rule[];
  imports: ImportReport[];
  tracker: TrackerConfig | null;
  derived: Derived;
  /** Expense categories to offer in the payee table */
  categories: string[];
  onChange: (next: MonzoChange) => void;
};

export function MonzoImport({ transactions, rules, imports, tracker, derived, categories, onChange }: Props) {
  const [account, setAccount] = useState<AccountKind>("personal");
  const [busy, setBusy] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [txnLimit, setTxnLimit] = useState(100);
  const [payeeLimit, setPayeeLimit] = useState(40);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const trackerRef = useRef<HTMLInputElement>(null);

  /* ---------------------------- Budget tracker rules ---------------------------- */

  async function importTracker(file: File) {
    setTrackerError(null);
    setBusy(`Learning rules from ${file.name}…`);
    try {
      onChange({ tracker: await parseTrackerWorkbook(await file.arrayBuffer(), file.name) });
    } catch (err) {
      setTrackerError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }

  /* ---------------------------- Import ---------------------------- */

  async function importFiles(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    let allTxns = [...transactions];
    const known = new Set(allTxns.map((t) => t.id));
    const newReports: ImportReport[] = [];

    for (const [i, file] of list.entries()) {
      setBusy(`Reading ${file.name} (${i + 1} of ${list.length})…`);
      let result: ParseResult;
      try {
        if (/\.csv$/i.test(file.name)) {
          result = parseMonzoCsv(await file.text(), file.name, account);
        } else if (/\.pdf$/i.test(file.name)) {
          result = parseStatementPages(await extractPdfPages(await file.arrayBuffer()), file.name, account);
        } else {
          result = failure(file.name, account, "Only Monzo CSV or PDF statements can be imported.");
        }
      } catch (err) {
        result = failure(file.name, account, `The file couldn't be read: ${err instanceof Error ? err.message : String(err)}`);
      }

      let imported = 0;
      let duplicates = 0;
      for (const t of result.txns) {
        if (known.has(t.id)) {
          duplicates++;
          continue;
        }
        known.add(t.id);
        allTxns.push(t);
        imported++;
      }

      // Same account, same dates, other format: likely double counting
      const warnings = [...result.report.warnings];
      if (result.report.from && result.report.to) {
        const other = transactions.filter(
          (t) =>
            t.account === account &&
            t.source !== result.report.format &&
            t.date >= result.report.from! &&
            t.date <= result.report.to!
        );
        if (other.length) {
          warnings.push(
            `${other.length} ${account} transactions in this date range were already imported from a ${other[0].source.toUpperCase()}. ` +
              "Import each month from one format only, or remove one of the imports below."
          );
        }
      }

      newReports.push({
        ...result.report,
        warnings,
        id: uid(),
        importedAt: new Date().toISOString(),
        imported,
        duplicates,
      });
    }

    allTxns = allTxns.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
    onChange({ transactions: allTxns, imports: [...newReports, ...imports] });
    setOpenReport(newReports.find((r) => r.failed.length || r.reconciliation?.ok === false)?.id ?? null);
    setBusy(null);
  }

  function removeImport(r: ImportReport) {
    onChange({
      transactions: transactions.filter((t) => !(t.file === r.file && t.account === r.account)),
      imports: imports.filter((x) => x.id !== r.id),
    });
  }

  function clearAll() {
    if (confirm("Remove every imported transaction? Rows you typed in yourself are kept.")) {
      onChange({ transactions: [], imports: [] });
    }
  }

  /* ---------------------------- Rules ---------------------------- */

  function setRule(name: string, cls: TxnClass, category?: string) {
    const existing = rules.find((r) => r.match.toLowerCase() === name.toLowerCase());
    const next: Rule = { id: existing?.id ?? uid(), match: name, class: cls, category };
    onChange({ rules: existing ? rules.map((r) => (r.id === existing.id ? next : r)) : [...rules, next] });
  }

  /* ---------------------------- Views ---------------------------- */

  const payees = useMemo(() => {
    const map = new Map<
      string,
      { name: string; account: AccountKind; count: number; total: number; cls: TxnClass; category: string; review: number }
    >();
    derived.classified.forEach((t) => {
      const k = `${t.account}|${normName(t.name)}`;
      const g = map.get(k) ?? { name: t.name, account: t.account, count: 0, total: 0, cls: t.cls, category: t.category, review: 0 };
      g.count++;
      g.total += t.amountPence;
      if (t.review) g.review++;
      map.set(k, g);
    });
    return [...map.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [derived.classified]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = [...derived.classified].reverse().filter((t) => !reviewOnly || t.review);
    return q ? rows.filter((t) => `${t.name} ${t.description} ${t.cls} ${t.category}`.toLowerCase().includes(q)) : rows;
  }, [derived.classified, search, reviewOnly]);

  const reviewCount = derived.classified.filter((t) => t.review).length;

  const budgetRows = (tracker?.categories ?? [])
    .filter((c) => c.budget !== undefined)
    .map((c) => ({ name: c.name, budget: c.budget!, actual: derived.categoryActuals[c.name] ?? 0 }));

  const coverage = (["personal", "business"] as AccountKind[]).map((a) => {
    const ts = transactions.filter((t) => t.account === a);
    return { account: a, count: ts.length, from: ts[0]?.date, to: ts[ts.length - 1]?.date, hasBalance: ts.some((t) => t.balancePence !== undefined) };
  });

  return (
    <div className="space-y-4">
      <Card className="fx-rise" style={{ ["--i" as string]: 0 }}>
        <CardHeader>
          <CardTitle>Budget tracker rules</CardTitle>
          <CardDescription>
            Upload your budget tracker workbook and every row of its Payment Log becomes a rule, using the exact category names.
            Committed bills, debt repayments, budgets per category and the rent netting come from the workbook too.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant={tracker ? "outline" : "default"} onClick={() => trackerRef.current?.click()} disabled={!!busy}>
              <FileSpreadsheet className="size-4" /> {tracker ? "Update from a newer tracker" : "Import budget tracker (.xlsx)"}
            </Button>
            {tracker && (
              <Button variant="ghost" onClick={() => onChange({ tracker: null })}>
                Stop using these rules
              </Button>
            )}
            <input
              ref={trackerRef}
              type="file"
              accept=".xlsx,.xlsm,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importTracker(f);
                e.target.value = "";
              }}
            />
          </div>
          {trackerError && <p className="text-sm text-destructive">{trackerError}</p>}
          {tracker && (
            <div className="space-y-3 text-sm">
              <p>
                <span className="font-medium">{tracker.file}</span>: read {tracker.logRows} Payment Log rows, learned from{" "}
                {tracker.learnedRows}, giving {Object.keys(tracker.merchants).length} description rules across{" "}
                {tracker.categories.length} categories. {tracker.debts.length} debts added to the Balances tab.
              </p>
              {tracker.skipped.length > 0 && (
                <div>
                  <button className="text-left underline underline-offset-4" onClick={() => setShowSkipped((v) => !v)}>
                    {tracker.skipped.length} rows couldn&apos;t be learned from
                  </button>
                  {showSkipped && (
                    <ul className="mt-2 space-y-1 text-muted-foreground">
                      {tracker.skipped.map((s) => (
                        <li key={s.row}>
                          Row {s.row}: {s.reason}. <span className="break-all">{s.raw}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <p className="text-muted-foreground">
                Committed: {tracker.categories.filter((c) => c.committed).map((c) => c.name).join(", ")}.
              </p>
              {budgetRows.length > 0 && transactions.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Budget / month</TableHead>
                        <TableHead className="text-right">Actual / month</TableHead>
                        <TableHead className="text-right">Difference</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {budgetRows.map((b) => {
                        const over = b.actual - b.budget;
                        return (
                          <TableRow key={b.name}>
                            <TableCell className="font-medium">{b.name}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatPence(b.budget * 100)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatPence(b.actual * 100)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${over > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                              {over > 0 ? `${formatPence(over * 100)} over` : `${formatPence(-over * 100)} under`}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="fx-rise" style={{ ["--i" as string]: 1 }}>
        <CardHeader>
          <CardTitle>Import Monzo statements</CardTitle>
          <CardDescription>
            CSV exports are the most reliable: every row is read exactly as Monzo wrote it. PDF statements also work, and every
            row is checked against the running balance so a missed or misread line is flagged, never skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>Which account are these from?</Label>
              <Select value={account} onValueChange={(v) => setAccount(v as AccountKind)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal account</SelectItem>
                  <SelectItem value="business">Business account</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => fileRef.current?.click()} disabled={!!busy}>
              <FileUp className="size-4" /> Choose statements
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".csv,.pdf,text/csv,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) importFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) importFiles(e.dataTransfer.files);
            }}
            className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
          >
            {busy ?? `Or drop ${account} statements here (CSV or PDF, as many as you like).`}
          </div>
          <p className="text-sm text-muted-foreground">
            Uploading the same statement twice is safe; rows already imported are skipped. Files are read in your browser and
            never uploaded anywhere.
          </p>
        </CardContent>
      </Card>

      {imports.length > 0 && (
        <Card className="fx-rise" style={{ ["--i" as string]: 2 }}>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="space-y-1.5">
              <CardTitle>Import checks</CardTitle>
              <CardDescription>Every file must show a green check. Open any red one to see the exact lines.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={clearAll}>
              <Trash2 className="size-4" /> Remove all imports
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Rows found</TableHead>
                    <TableHead className="text-right">Added</TableHead>
                    <TableHead className="text-right">Already had</TableHead>
                    <TableHead className="text-right">Problems</TableHead>
                    <TableHead>Check</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map((r) => {
                    const problems = r.failed.length + (r.reconciliation?.breaks.length ?? 0);
                    const ok = problems === 0 && r.rowsFound > 0;
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => setOpenReport(openReport === r.id ? null : r.id)}
                      >
                        <TableCell className="max-w-56 truncate font-medium">{r.file}</TableCell>
                        <TableCell className="capitalize">{r.account}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.from ? `${r.from} to ${r.to}` : "–"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.rowsFound}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.imported}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.duplicates}</TableCell>
                        <TableCell className="text-right tabular-nums">{problems}</TableCell>
                        <TableCell>
                          {ok ? (
                            <Badge variant="secondary">
                              {r.format === "pdf" ? "Balances reconcile" : "Every row read"}
                            </Badge>
                          ) : (
                            <Badge variant="destructive">Check {problems || "file"}</Badge>
                          )}
                          {r.warnings.length > 0 && (
                            <Badge variant="outline" className="ml-1">
                              {r.warnings.length} note{r.warnings.length > 1 ? "s" : ""}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove this import"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeImport(r);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {imports
              .filter((r) => r.id === openReport)
              .map((r) => (
                <div key={r.id} className="space-y-3 rounded-md border p-4 text-sm">
                  <p className="font-medium">{r.file}</p>
                  {r.reconciliation && (
                    <p className="text-muted-foreground">
                      {r.reconciliation.checked} rows checked against the running balance.
                      {r.reconciliation.openingPence !== undefined && ` Opening ${formatPence(r.reconciliation.openingPence)}.`}
                      {r.reconciliation.closingPence !== undefined && ` Closing ${formatPence(r.reconciliation.closingPence)}.`}
                    </p>
                  )}
                  {r.warnings.map((w, i) => (
                    <p key={i} className="text-muted-foreground">
                      {w}
                    </p>
                  ))}
                  {r.reconciliation?.breaks.map((b, i) => (
                    <div key={i} className="rounded border border-destructive/40 p-2">
                      <p className="font-medium text-destructive">
                        Balance doesn&apos;t follow at {b.where}: expected {formatPence(b.expectedPence)}, statement says{" "}
                        {formatPence(b.actualPence)}.
                      </p>
                      <p className="text-muted-foreground">
                        A row just above this one was missed or misread. Row text: {b.raw}
                      </p>
                    </div>
                  ))}
                  {r.failed.map((f, i) => (
                    <div key={i} className="rounded border border-destructive/40 p-2">
                      <p className="font-medium text-destructive">
                        {f.where}: {f.reason}
                      </p>
                      {f.raw && <p className="break-all text-muted-foreground">{f.raw}</p>}
                    </div>
                  ))}
                  {r.failed.length === 0 && !r.reconciliation?.breaks.length && (
                    <p className="text-muted-foreground">No problems. Every row in this file is on the dashboard.</p>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {transactions.length > 0 && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="fx-rise" style={{ ["--i" as string]: 3 }}>
              <CardHeader>
                <CardTitle>Coverage</CardTitle>
                <CardDescription>Dashboard figures are monthly averages over these months.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {coverage.map((c) => (
                  <div key={c.account}>
                    <p className="font-medium capitalize">{c.account}</p>
                    <p className="text-muted-foreground">
                      {c.count ? `${c.count} transactions, ${c.from} to ${c.to}` : "Nothing imported yet"}
                    </p>
                    {c.count > 0 && !c.hasBalance && (
                      <p className="text-muted-foreground">
                        CSV exports don&apos;t include a balance. Update this account on the Balances tab.
                      </p>
                    )}
                  </div>
                ))}
                <p className="text-muted-foreground">
                  Rows added from statements end in &quot;(Monzo …)&quot;. They&apos;re rebuilt on every import, so change them with the
                  payee settings below rather than editing them directly.
                </p>
              </CardContent>
            </Card>

            <Card className="fx-rise lg:col-span-2" style={{ ["--i" as string]: 4 }}>
              <CardHeader>
                <CardTitle>Actual money in and out</CardTitle>
                <CardDescription>By month, excluding transfers between your own accounts and pots</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={derived.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                      <YAxis tick={{ fontSize: 12 }} width={56} stroke="var(--muted-foreground)" />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatPence(Number(v) * 100)} />
                      <Legend />
                      <Bar dataKey="moneyIn" name="In" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="moneyOut" name="Out" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="fx-rise" style={{ ["--i" as string]: 5 }}>
            <CardHeader>
              <CardTitle>Payees</CardTitle>
              <CardDescription>
                Fix anything sorted wrongly and the dashboard updates straight away. Mark money moving between your personal
                and business accounts as Own transfer so it isn&apos;t counted twice.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payee</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Treat as</TableHead>
                      <TableHead>Category</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payees.slice(0, payeeLimit).map((p) => (
                      <TableRow key={`${p.account}|${p.name}`}>
                        <TableCell className="max-w-64 font-medium">
                          <div className="truncate">{p.name}</div>
                          {p.review > 0 && (
                            <Badge variant="outline" className="mt-1">
                              Check sorting
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="capitalize">{p.account}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPence(p.total)}</TableCell>
                        <TableCell>
                          <Select value={p.cls} onValueChange={(v) => setRule(p.name, v as TxnClass, p.category)}>
                            <SelectTrigger className="h-8 w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CLASSES.map((c) => (
                                <SelectItem key={c.value} value={c.value}>
                                  {c.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {p.cls === "expense" ? (
                            <Select value={p.category} onValueChange={(v) => setRule(p.name, p.cls, v ?? undefined)}>
                              <SelectTrigger className="h-8 w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {categories.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {c}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {payees.length > payeeLimit && (
                <Button variant="outline" size="sm" onClick={() => setPayeeLimit((n) => n + 40)}>
                  Show more payees ({payees.length - payeeLimit} left)
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className="fx-rise" style={{ ["--i" as string]: 6 }}>
            <CardHeader>
              <CardTitle>All transactions</CardTitle>
              <CardDescription>
                {transactions.length} imported. Newest first. The last column shows where each row came from in its file.
                {reviewCount > 0 &&
                  ` ${reviewCount} need a check: either no rule matched, or your tracker filed the same description under different categories.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input placeholder="Search payee, category or type" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
                <Button variant={reviewOnly ? "default" : "outline"} onClick={() => setReviewOnly((v) => !v)}>
                  {reviewOnly ? "Showing rows to check" : `Rows to check (${reviewCount})`}
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Payee</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Treated as</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.slice(0, txnLimit).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="whitespace-nowrap tabular-nums">{t.date}</TableCell>
                        <TableCell className="max-w-72">
                          <div className="truncate font-medium">{t.name}</div>
                          {t.description && t.description !== t.name && (
                            <div className="truncate text-xs text-muted-foreground">{t.description}</div>
                          )}
                        </TableCell>
                        <TableCell className="capitalize">{t.account}</TableCell>
                        <TableCell>
                          <div>
                            {CLASSES.find((c) => c.value === t.cls)?.label}
                            {t.cls !== "transfer" && t.cls !== "ignore" && <span className="text-muted-foreground"> ({t.category})</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t.review ? <span className="text-amber-600 dark:text-amber-400">Check: {t.matchedBy}</span> : t.matchedBy}
                          </div>
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${t.amountPence > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                          {formatPence(t.amountPence)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {t.balancePence !== undefined ? formatPence(t.balancePence) : "–"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {t.file}, {t.where}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {filtered.length > txnLimit && (
                <Button variant="outline" size="sm" onClick={() => setTxnLimit((n) => n + 200)}>
                  Show more ({filtered.length - txnLimit} left)
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function failure(file: string, account: AccountKind, reason: string): ParseResult {
  return {
    txns: [],
    report: {
      file,
      account,
      format: /\.pdf$/i.test(file) ? "pdf" : "csv",
      rowsFound: 0,
      failed: [{ where: "file", raw: "", reason }],
      warnings: [],
    },
  };
}
