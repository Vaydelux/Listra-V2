import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp, Receipt, Wallet, Percent, AlertTriangle, PackagePlus } from "lucide-react";
import { useApp, useCurrency, openQuickAdd } from "../store";
import { kpiSummary, dailySeries, lowStockProducts, listSales, listExpenses, productAggregates } from "../lib/data";
import { presetRange, rangeToUtc, relTime } from "../lib/format";
import { Kpi, Money, Delta, Badge, StockBadge, EmptyState, Button, cx } from "../components/ui";
import { ReceiptModal } from "../components/modals";
import { useState } from "react";
import type { Sale } from "../lib/types";

export default function Dashboard() {
  const { ws, tick, online } = useApp();
  const cur = useCurrency();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<Sale | null>(null);

  const data = useMemo(() => {
    if (!ws) return null;
    const range = presetRange("LAST30", ws.timezone);
    const { fromMs, toMs } = rangeToUtc(range.from, range.to, ws.timezone);
    return {
      kpi: kpiSummary(ws.id, fromMs, toMs),
      series: dailySeries(ws.id, range.from, range.to, ws.timezone),
      low: lowStockProducts(ws.id),
      recentSales: listSales(ws.id, { pageSize: 6 }).rows,
      recentExpenses: listExpenses(ws.id, { pageSize: 5 }).rows,
      top: productAggregates(ws.id, fromMs, toMs).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, tick]);

  if (!ws || !data) return null;
  const { cur: k, prev } = data.kpi;

  return (
    <div className="fade-up mx-auto max-w-[1240px] space-y-4">
      {/* low-stock strip */}
      {data.low.length > 0 && (
        <div className="card-flat flex flex-wrap items-center gap-2.5 px-4 py-3" style={{ borderColor: "color-mix(in srgb, var(--warn) 35%, var(--border))" }}>
          <span className="flex items-center gap-2 text-[13px] font-bold" style={{ color: "var(--warn)" }}>
            <AlertTriangle size={15} /> {data.low.length} product{data.low.length > 1 ? "s" : ""} at or below reorder level
          </span>
          <div className="flex flex-1 flex-wrap gap-1.5">
            {data.low.slice(0, 5).map((p) => (
              <button key={p.id} className="chip h-[26px]! px-2.5! text-[11.5px]!" onClick={() => navigate(`/inventory?open=${p.id}`)}>
                {p.name} <StockBadge stock={p.stock} reorder={p.reorderLevel} />
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => openQuickAdd("restock")} disabled={!online}><PackagePlus size={13} /> Restock</Button>
        </div>
      )}

      {/* KPIs */}
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Revenue · 30d" tone="accent" value={<Money value={k.revenue} />} delta={<Delta cur={k.revenue} prev={prev.revenue} />} />
        <Kpi label="Gross profit" tone="ok" value={<Money value={k.grossProfit} />} delta={<Delta cur={k.grossProfit} prev={prev.grossProfit} />} sub={<span className="mono text-[11px]">{k.grossMargin.toFixed(1)}% margin</span>} />
        <Kpi label="Expenses" value={<Money value={k.expenses} />} delta={<Delta cur={k.expenses} prev={prev.expenses} invert />} />
        <Kpi label="Net profit" tone={k.netProfit >= 0 ? "ok" : "bad"} value={<Money value={k.netProfit} />} delta={<Delta cur={k.netProfit} prev={prev.netProfit} />} sub={<span className="mono text-[11px]">{k.netMargin.toFixed(1)}% net</span>} />
      </div>

      {/* trend + side stats */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-flat p-4 lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-display text-[15.5px] font-bold">Revenue & net profit — last 30 days</h2>
            <button className="chip" onClick={() => navigate("/reports")}>Full reports</button>
          </div>
          <p className="mb-2 text-[12px] text-[var(--muted)]">Day boundaries follow {ws.timezone}</p>
          <div className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gNet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "var(--faint)", fontSize: 10.5 }} axisLine={false} tickLine={false} minTickGap={28} />
                <YAxis tick={{ fill: "var(--faint)", fontSize: 10.5 }} axisLine={false} tickLine={false} width={46} tickFormatter={(v: number) => cur.format(v, { compact: true })} />
                <Tooltip contentStyle={{ background: "var(--raised)", border: "1px solid var(--border-strong)", borderRadius: 10, fontSize: 12.5 }}
                  labelStyle={{ color: "var(--muted)", fontWeight: 700 }} formatter={(value) => cur.format(Number(value))} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="var(--chart-1)" strokeWidth={2} fill="url(#gRev)" />
                <Area type="monotone" dataKey="net" name="Net profit" stroke="var(--chart-2)" strokeWidth={2} fill="url(#gNet)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card-flat p-4">
            <h2 className="mb-2.5 flex items-center gap-2 font-display text-[15px] font-bold"><TrendingUp size={15} className="text-[var(--accent-soft-fg)]" /> Quick stats</h2>
            <div className="grid grid-cols-2 gap-2.5 text-[13px]">
              {([
                ["Sales", String(k.count)], ["Units sold", k.units.toLocaleString()],
                ["Avg order", cur.format(k.aov)], ["COGS", cur.format(k.cogs)],
              ] as const).map(([l, v]) => (
                <div key={l} className="inset-panel px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--faint)]">{l}</p>
                  <p className="mono mt-0.5 text-[14.5px] font-bold">{v}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="card-flat p-4">
            <h2 className="mb-2.5 font-display text-[15px] font-bold">Top products · 30d</h2>
            {data.top.length === 0 ? <p className="text-[12.5px] text-[var(--muted)]">No sales in range yet.</p> : (
              <div className="space-y-1.5">
                {data.top.map((p, i) => (
                  <div key={p.productId} className="flex items-center gap-2.5">
                    <span className="mono w-4 text-[11px] font-bold text-[var(--faint)]">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold">{p.name}</p>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface2)]">
                        <div className="h-full rounded-full" style={{ width: `${(p.revenue / (data.top[0].revenue || 1)) * 100}%`, background: "var(--accent)" }} />
                      </div>
                    </div>
                    <Money value={p.revenue} className="shrink-0 text-[12px] font-bold" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* recent activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-flat p-4 lg:col-span-2">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-display text-[15px] font-bold"><Receipt size={15} className="text-[var(--accent-soft-fg)]" /> Recent sales</h2>
            <button className="chip" onClick={() => navigate("/sales")}>View all</button>
          </div>
          {data.recentSales.length === 0 ? (
            <EmptyState title="No sales yet" body="Record your first sale — stock, snapshots and the audit trail update atomically." action={<Button onClick={() => openQuickAdd("sale")}>New sale</Button>} />
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {data.recentSales.map((s) => (
                <button key={s.id} className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-[var(--surface2)]" onClick={() => setReceipt(s)}>
                  <span className="mono w-[92px] shrink-0 text-[12px] font-bold text-[var(--accent-soft-fg)]">{s.txn}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--muted)]">{s.customerName || s.items.map((i) => i.name).join(", ")}</span>
                  {s.status === "VOID" && <Badge tone="bad">void</Badge>}
                  <Money value={s.total} className="shrink-0 text-[13px] font-bold" />
                  <span className="mono hidden w-[64px] shrink-0 text-right text-[10.5px] text-[var(--faint)] sm:block">{relTime(s.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="card-flat p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-display text-[15px] font-bold"><Wallet size={15} className="text-[var(--accent-soft-fg)]" /> Recent expenses</h2>
            <button className="chip" onClick={() => navigate("/expenses")}>View all</button>
          </div>
          {data.recentExpenses.length === 0 ? <p className="text-[12.5px] text-[var(--muted)]">Nothing recorded yet.</p> : (
            <div className="space-y-2">
              {data.recentExpenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold">{e.vendor || e.note || "Expense"}</p>
                    <p className="mono text-[10.5px] text-[var(--faint)]">{e.date}</p>
                  </div>
                  <Money value={e.amount} className="shrink-0 text-[12.5px] font-bold" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ReceiptModal open={!!receipt} onClose={() => setReceipt(null)} sale={receipt} />
    </div>
  );
}
