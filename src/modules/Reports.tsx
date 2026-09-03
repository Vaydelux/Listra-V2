import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { Download, Mail, TrendingDown } from "lucide-react";
import { useApp, useCurrency, useThemeStore, toast } from "../store";
import {
  kpiSummary, dailySeries, paymentDistribution, expenseBreakdown, productAggregates,
  lowStockProducts, inventoryValuation, buildReportCsv, buildSalesCsv, buildExpensesCsv,
  sendReportEmail,
} from "../lib/data";
import { isAppError } from "../lib/types";
import type { AppError } from "../lib/types";
import { presetRange, rangeToUtc, downloadCsv, fmtDate } from "../lib/format";
import type { RangePreset } from "../lib/format";
import { Button, Input, Field, TextArea, Switch, Badge, Money, Kpi, PageHeader, Modal, StockBadge } from "../components/ui";
import { resolveTheme } from "../lib/theme";

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "TODAY", label: "Today" }, { id: "WEEK", label: "This week" }, { id: "MONTH", label: "This month" },
  { id: "LAST_MONTH", label: "Last month" }, { id: "LAST30", label: "30 days" }, { id: "LAST90", label: "90 days" },
  { id: "CUSTOM", label: "Custom" },
];

export default function Reports() {
  const { ws, tick, can, online } = useApp();
  const cur = useCurrency();
  const { themeId } = useThemeStore();
  const [params, setParams] = useSearchParams();
  const preset = (params.get("preset") ?? "LAST30") as RangePreset;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [emailOpen, setEmailOpen] = useState(false);

  const upd = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (!v) next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true });
  };

  const chart = resolveTheme(themeId).v.chart;

  const data = useMemo(() => {
    if (!ws) return null;
    const range = presetRange(preset, ws.timezone, { from: from || isoMinus(29), to: to || isoToday() });
    const { fromMs, toMs } = rangeToUtc(range.from, range.to, ws.timezone);
    const kpi = kpiSummary(ws.id, fromMs, toMs);
    return {
      range, fromMs, toMs, ...kpi,
      series: dailySeries(ws.id, range.from, range.to, ws.timezone),
      pay: paymentDistribution(ws.id, fromMs, toMs),
      expCats: expenseBreakdown(ws.id, fromMs, toMs),
      byRevenue: productAggregates(ws.id, fromMs, toMs).sort((a, b) => b.revenue - a.revenue).slice(0, 6),
      byProfit: productAggregates(ws.id, fromMs, toMs).sort((a, b) => b.grossProfit - a.grossProfit).slice(0, 6),
      laggards: productAggregates(ws.id, fromMs, toMs).filter((p) => p.units > 0).sort((a, b) => a.grossProfit - b.grossProfit).slice(0, 5),
      low: lowStockProducts(ws.id),
      valuation: inventoryValuation(ws.id),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, tick, preset, from, to]);

  if (!ws || !data) return null;
  const { cur: k, prev } = data;

  const exportSummary = () => {
    try {
      const { csv, filename } = buildReportCsv(ws.id, data.fromMs, data.toMs, data.range.from, data.range.to);
      downloadCsv(filename, csv);
      toast("Report summary CSV exported");
    } catch (e) { toast(isAppError(e) ? e.message : "Export failed", "error"); }
  };
  const exportList = (kind: "sales" | "expenses") => {
    try {
      const r = kind === "sales" ? buildSalesCsv(ws.id) : buildExpensesCsv(ws.id);
      downloadCsv(r.filename, r.csv);
      toast(`${kind === "sales" ? "Sales" : "Expenses"} CSV exported`);
    } catch (e) { toast(isAppError(e) ? e.message : "Export failed", "error"); }
  };

  return (
    <div className="fade-up mx-auto max-w-[1240px] space-y-4">
      <PageHeader title="Reports & Profit Intelligence" sub={`Business-day boundaries follow ${ws.timezone} — the workspace timezone`}>
        <Button variant="outline" size="sm" onClick={exportSummary} disabled={!can("reports.export")}><Download size={14} /> Summary CSV</Button>
        {can("reports.email") && <Button size="sm" onClick={() => setEmailOpen(true)} disabled={!online}><Mail size={14} /> Email report</Button>}
      </PageHeader>

      <div className="card-flat flex flex-wrap items-center gap-2 p-3">
        {PRESETS.map((p) => (
          <button key={p.id} className="chip" aria-pressed={preset === p.id} onClick={() => upd({ preset: p.id })}>{p.label}</button>
        ))}
        {preset === "CUSTOM" && (
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
            <Input type="date" className="w-[140px]" value={from} onChange={(e) => upd({ from: e.target.value })} aria-label="From" />
            –
            <Input type="date" className="w-[140px]" value={to} onChange={(e) => upd({ to: e.target.value })} aria-label="To" />
          </div>
        )}
        <span className="ml-auto text-[12px] font-medium text-[var(--muted)]">
          {fmtDate(new Date(data.fromMs).toISOString(), ws.timezone)} → {fmtDate(new Date(data.toMs - 1000).toISOString(), ws.timezone)}
        </span>
      </div>

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Revenue" tone="accent" value={<Money value={k.revenue} />} sub={<span className="mono text-[11px]">prev {cur.format(prev.revenue, { compact: true })}</span>} />
        <Kpi label="COGS" value={<Money value={k.cogs} />} sub={<span className="text-[11px]">cost snapshots</span>} />
        <Kpi label="Gross profit" tone="ok" value={<Money value={k.grossProfit} />} sub={<span className="mono text-[11px]">{k.grossMargin.toFixed(1)}% margin</span>} />
        <Kpi label="Expenses" value={<Money value={k.expenses} />} sub={<span className="text-[11px]">operating</span>} />
        <Kpi label="Net profit" tone={k.netProfit >= 0 ? "ok" : "bad"} value={<Money value={k.netProfit} />} sub={<span className="mono text-[11px]">{k.netMargin.toFixed(1)}% net margin</span>} />
        <Kpi label="Total sales" value={k.count} sub={<span className="text-[11px]">completed, non-void</span>} />
        <Kpi label="Avg order value" value={<Money value={k.aov} />} sub={<span className="text-[11px]">revenue ÷ sales</span>} />
        <Kpi label="Units sold" value={k.units.toLocaleString()} sub={<span className="text-[11px]">across all lines</span>} />
        <Kpi label="Inventory (cost)" value={<Money value={data.valuation.atCost} />} sub={<span className="text-[11px]">{data.valuation.units} units on hand</span>} />
        <Kpi label="Inventory (retail)" value={<Money value={data.valuation.atRetail} />} sub={<span className="text-[11px]">potential revenue</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card-flat p-4 lg:col-span-3">
          <h2 className="font-display text-[15.5px] font-bold">Performance over time</h2>
          <p className="mb-3 text-[12px] text-[var(--muted)]">Bars: revenue & expenses · Lines: gross & net profit</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "var(--faint)", fontSize: 10.5 }} axisLine={false} tickLine={false} minTickGap={28} />
                <YAxis tick={{ fill: "var(--faint)", fontSize: 10.5 }} axisLine={false} tickLine={false} width={46} tickFormatter={(v: number) => cur.format(v, { compact: true })} />
                <Tooltip contentStyle={{ background: "var(--raised)", border: "1px solid var(--border-strong)", borderRadius: 10, fontSize: 12.5 }}
                  labelStyle={{ color: "var(--muted)", fontWeight: 700 }} formatter={(value) => cur.format(Number(value))} />
                <Bar dataKey="revenue" name="Revenue" fill={chart[0]} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar dataKey="expenses" name="Expenses" fill={chart[2]} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line type="monotone" dataKey="gross" name="Gross profit" stroke={chart[1]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="net" name="Net profit" stroke={chart[3]} strokeWidth={2} strokeDasharray="5 3" dot={false} />
                <Legend wrapperStyle={{ fontSize: 11.5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card-flat p-4 lg:col-span-2">
          <h2 className="mb-3 font-display text-[15.5px] font-bold">Expense breakdown</h2>
          {data.expCats.length === 0 ? <p className="py-6 text-[13px] text-[var(--muted)]">No expenses in range.</p> : (
            <div className="space-y-2.5">
              {data.expCats.map((c, i) => {
                const max = data.expCats[0].total || 1;
                return (
                  <div key={c.categoryId}>
                    <div className="mb-1 flex items-center justify-between text-[12.5px]">
                      <span className="font-semibold">{c.name}</span>
                      <span className="mono text-[var(--muted)]">{cur.format(c.total)} · {k.expenses > 0 ? Math.round((c.total / k.expenses) * 100) : 0}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface2)]">
                      <div className="h-full rounded-full" style={{ width: `${(c.total / max) * 100}%`, background: chart[i % chart.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <h2 className="mb-1 mt-5 font-display text-[15.5px] font-bold">Payment methods</h2>
          <div className="flex items-center gap-3">
            <div className="h-[120px] w-[120px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.pay.map((p) => ({ name: p.method, value: p.total }))} dataKey="value" innerRadius={34} outerRadius={52} paddingAngle={2} stroke="none">
                    {data.pay.map((_, i) => <Cell key={i} fill={chart[i % chart.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--raised)", border: "1px solid var(--border-strong)", borderRadius: 10, fontSize: 12.5 }} formatter={(value) => cur.format(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              {data.pay.map((p, i) => (
                <div key={p.method} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="flex items-center gap-1.5 font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: chart[i % chart.length] }} />{p.method.replace("_", "-")}</span>
                  <span className="mono text-[var(--muted)]">{p.count} · {cur.format(p.total, { compact: true })}</span>
                </div>
              ))}
              {data.pay.length === 0 && <p className="text-[12.5px] text-[var(--muted)]">No completed sales in range.</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {([
          ["Top by revenue", data.byRevenue, "revenue"],
          ["Top by gross profit", data.byProfit, "grossProfit"],
        ] as const).map(([title, rows, metric]) => (
          <div key={title} className="card-flat p-4">
            <h2 className="mb-2.5 font-display text-[15.5px] font-bold">{title}</h2>
            {rows.length === 0 ? <p className="py-4 text-[13px] text-[var(--muted)]">No product sales in range.</p> : (
              <div className="space-y-2">
                {rows.map((p, i) => (
                  <div key={p.productId} className="flex items-center gap-2.5">
                    <span className="mono w-5 shrink-0 text-[11.5px] font-bold text-[var(--faint)]">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold">{p.name}</p>
                      <p className="mono text-[10.5px] text-[var(--faint)]">{p.sku} · {p.units} units</p>
                    </div>
                    <Money value={metric === "revenue" ? p.revenue : p.grossProfit} className="shrink-0 text-[13px] font-bold" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="card-flat p-4">
          <h2 className="mb-2.5 flex items-center gap-2 font-display text-[15.5px] font-bold"><TrendingDown size={15} className="text-[var(--warn)]" /> Low performers</h2>
          {data.laggards.length === 0 ? <p className="py-4 text-[13px] text-[var(--muted)]">Nothing flagged in this range.</p> : (
            <div className="space-y-2">
              {data.laggards.map((p) => (
                <div key={p.productId} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{p.name}</p>
                    <p className="mono text-[10.5px] text-[var(--faint)]">{p.units} units · revenue {cur.format(p.revenue, { compact: true })}</p>
                  </div>
                  <Badge tone={p.grossProfit < 0 ? "bad" : "warn"}>GP {cur.format(p.grossProfit, { compact: true })}</Badge>
                </div>
              ))}
            </div>
          )}
          <h2 className="mb-2 mt-4 font-display text-[15.5px] font-bold">Low stock now</h2>
          {data.low.length === 0 ? <p className="text-[13px] text-[var(--muted)]">All healthy.</p> : (
            <div className="flex flex-wrap gap-1.5">
              {data.low.slice(0, 6).map((p) => (
                <span key={p.id} className="chip cursor-default"><span className="max-w-[110px] truncate">{p.name}</span> <StockBadge stock={p.stock} reorder={p.reorderLevel} /></span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card-flat flex flex-wrap items-center gap-3 p-4">
        <div className="mr-auto">
          <h2 className="font-display text-[15.5px] font-bold">Exports</h2>
          <p className="text-[12px] text-[var(--muted)]">UTF-8 with BOM · formula-injection guarded · audited</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportSummary} disabled={!can("reports.export")}><Download size={14} /> Summary</Button>
        <Button variant="outline" size="sm" onClick={() => exportList("sales")} disabled={!can("reports.export")}><Download size={14} /> Sales</Button>
        <Button variant="outline" size="sm" onClick={() => exportList("expenses")} disabled={!can("reports.export")}><Download size={14} /> Expenses</Button>
      </div>

      <EmailReportsModal open={emailOpen} onClose={() => setEmailOpen(false)} rangeLabel={`${data.range.from} → ${data.range.to}`}
        kpi={k} lowCount={data.low.length} top={data.byRevenue.slice(0, 3).map((p) => ({ name: p.name, revenue: p.revenue }))} />
    </div>
  );
}

function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function isoMinus(days: number): string { return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10); }

/* ---------------- email reports ---------------- */

function EmailReportsModal({ open, onClose, rangeLabel, kpi, lowCount, top }: {
  open: boolean; onClose: () => void; rangeLabel: string;
  kpi: { revenue: number; cogs: number; grossProfit: number; expenses: number; netProfit: number; netMargin: number };
  lowCount: number; top: { name: string; revenue: number }[];
}) {
  const { ws, online } = useApp();
  const cur = useCurrency();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [includeCsv, setIncludeCsv] = useState(true);
  const [includeLow, setIncludeLow] = useState(true);
  const [err, setErr] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTo(ws?.business.email ?? "");
      setSubject(`${ws?.name ?? "Business"} — Executive summary ${rangeLabel}`);
      setMessage(""); setErr(null); setSent(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const { messageId } = await sendReportEmail({ to, subject, message, includeCsv, includeLowStock: includeLow }, rangeLabel);
      setSent(messageId);
      toast("Executive report dispatched via SMTP");
    } catch (e) {
      setErr(isAppError(e) ? e : { code: "UNEXPECTED", message: "Email failed." });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Email executive report" sub={ws?.smtp.configured ? `Sending through ${ws.smtp.host}:${ws.smtp.port}` : "SMTP is not configured yet"} width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{sent ? "Close" : "Cancel"}</Button>
          {!sent && <Button onClick={submit} loading={busy} disabled={!online || !to.includes("@")}><Mail size={14} /> Send report</Button>}
        </>
      }>
      {sent ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Badge tone="ok">Delivered to transport queue</Badge>
          <p className="text-[13.5px] font-semibold">Report emailed to {to}</p>
          <p className="mono text-[11px] text-[var(--faint)]">{sent}</p>
          <p className="max-w-[380px] text-[12px] text-[var(--muted)]">The demo transport simulates Nodemailer delivery. In production this runs exclusively in Node.js server code with credentials that never reach the browser.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {err && (
            <div className="rounded-[10px] border px-3.5 py-2.5 text-[13px] font-medium" style={{ borderColor: "color-mix(in srgb, var(--negative) 40%, transparent)", background: "color-mix(in srgb, var(--negative) 10%, transparent)", color: "var(--negative)" }} role="alert">
              {err.message}
            </div>
          )}
          {!ws?.smtp.configured && (
            <p className="rounded-[10px] bg-[var(--surface2)] px-3.5 py-2.5 text-[12.5px] text-[var(--muted)]">Configure SMTP under Settings → SMTP & email before sending.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Recipient"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="owner@business.com" /></Field>
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          </div>
          <Field label="Personal message (optional)"><TextArea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi — here's this period at a glance…" /></Field>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-[13px] font-medium text-[var(--muted)]"><Switch checked={includeCsv} onChange={setIncludeCsv} label="Attach CSV" /> Attach CSV</label>
            <label className="flex items-center gap-2 text-[13px] font-medium text-[var(--muted)]"><Switch checked={includeLow} onChange={setIncludeLow} label="Include low stock" /> Low-stock digest ({lowCount})</label>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-[var(--border)]">
            <div className="px-4 py-3" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>
              <p className="font-display text-[14.5px] font-bold">{ws?.business.name} — Executive summary</p>
              <p className="text-[11.5px] opacity-80">{rangeLabel} · generated by Listra</p>
            </div>
            <div className="grid grid-cols-2 gap-px sm:grid-cols-3" style={{ background: "var(--border)" }}>
              {([
                ["Revenue", cur.format(kpi.revenue)], ["COGS", cur.format(kpi.cogs)], ["Gross profit", cur.format(kpi.grossProfit)],
                ["Expenses", cur.format(kpi.expenses)], ["Net profit", cur.format(kpi.netProfit)], ["Net margin", `${kpi.netMargin.toFixed(1)}%`],
              ] as const).map(([l, v]) => (
                <div key={l} className="px-3.5 py-2.5" style={{ background: "var(--surface)" }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--faint)]">{l}</p>
                  <p className="mono mt-0.5 text-[14px] font-bold">{v}</p>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 text-[12px] text-[var(--muted)]" style={{ background: "var(--surface)" }}>
              {top.length > 0 && <p className="mb-1"><strong className="text-[var(--text)]">Top products:</strong> {top.map((t) => `${t.name} (${cur.format(t.revenue, { compact: true })})`).join(" · ")}</p>}
              {includeLow && <p><strong className="text-[var(--text)]">Low stock:</strong> {lowCount === 0 ? "none — all healthy" : `${lowCount} product(s) at or below reorder level`}</p>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
