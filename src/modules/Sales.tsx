import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Receipt, Ban, ShoppingCart } from "lucide-react";
import { useApp, useCurrency, toast } from "../store";
import { listSales, voidSale } from "../lib/data";
import { isAppError } from "../lib/types";
import type { Sale } from "../lib/types";
import { PAYMENT_METHODS } from "../lib/types";
import { fmtDate, downloadCsv } from "../lib/format";
import { Button, Input, Select, Badge, Money, Pagination, Sheet, EmptyState, PageHeader, Menu, Modal, Field, TextArea } from "../components/ui";
import { SaleModal, ReceiptModal } from "../components/modals";

export default function Sales() {
  const { ws, tick, can, online } = useApp();
  const cur = useCurrency();
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "all";
  const method = params.get("method") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Number(params.get("page") ?? "1");
  const openId = params.get("open");

  const upd = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || (k === "status" && v === "all")) next.delete(k); else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => { if (debouncedQ !== q) upd({ q: debouncedQ }); }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const [composer, setComposer] = useState(false);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [receipt, setReceipt] = useState<Sale | null>(null);

  const data = useMemo(() => {
    if (!ws) return null;
    const fromMs = from ? new Date(from + "T00:00:00Z").getTime() : undefined;
    const toMs = to ? new Date(to + "T00:00:00Z").getTime() + 86_400_000 : undefined;
    return {
      paged: listSales(ws.id, { q, status: status as "all" | "COMPLETED" | "VOID", method: method || undefined, fromMs, toMs, page, pageSize: 9 }),
      open: openId ? listSales(ws.id, { pageSize: 1000 }).rows.find((s) => s.id === openId) ?? null : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, tick, q, status, method, from, to, page, openId]);

  if (!ws || !data) return null;
  const sale = data.open;
  const pmLabel = (m: string) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m;

  const doVoid = () => {
    if (!voiding) return;
    try {
      voidSale(voiding.id, voidReason.trim());
      toast(`Sale ${voiding.txn} voided — stock restored via REVERSAL movements`);
      setVoiding(null); setVoidReason("");
    } catch (e) { toast(isAppError(e) ? e.message : "Void failed", "error"); }
  };

  return (
    <div className="fade-up mx-auto max-w-[1240px]">
      <PageHeader title="Sales" sub="Immutable snapshots — product edits never restate history">
        {can("sales.create") && <Button size="sm" onClick={() => setComposer(true)} disabled={!online}><Plus size={15} /> Record sale</Button>}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-[220px]">
          <Input placeholder="Search txn, customer, product…" value={debouncedQ} onChange={(e) => setDebouncedQ(e.target.value)} aria-label="Search sales" />
        </div>
        <Select className="w-[130px]" value={status} onChange={(e) => upd({ status: e.target.value })} aria-label="Status filter">
          <option value="all">All statuses</option><option value="COMPLETED">Completed</option><option value="VOID">Voided</option>
        </Select>
        <Select className="w-[150px]" value={method} onChange={(e) => upd({ method: e.target.value })} aria-label="Payment filter">
          <option value="">All payments</option>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
          <Input type="date" className="w-[140px]" value={from} onChange={(e) => upd({ from: e.target.value })} aria-label="From date" />
          –
          <Input type="date" className="w-[140px]" value={to} onChange={(e) => upd({ to: e.target.value })} aria-label="To date" />
        </div>
      </div>

      {data.paged.total === 0 ? (
        <EmptyState title="No sales found" body="Record a multi-item sale — stock deducts atomically and every line is snapshot-immutable."
          icon={<ShoppingCart size={22} />}
          action={can("sales.create") ? <Button onClick={() => setComposer(true)} disabled={!online}><Plus size={15} /> Record sale</Button> : undefined} />
      ) : (
        <>
          <div className="card-flat hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Txn</th><th>Date</th><th>Customer</th><th>Items</th><th>Payment</th><th className="num">Total</th><th>Status</th><th className="num">Actions</th></tr></thead>
                <tbody>
                  {data.paged.rows.map((s) => (
                    <tr key={s.id} className="cursor-pointer" onClick={() => upd({ open: s.id })}>
                      <td className="mono text-[12.5px] font-bold text-[var(--accent-soft-fg)]">{s.txn}</td>
                      <td className="mono text-[12px] text-[var(--muted)]">{fmtDate(s.createdAt, ws.timezone, true)}</td>
                      <td className="max-w-[140px] truncate text-[13px]">{s.customerName || "—"}</td>
                      <td className="text-[12.5px] text-[var(--muted)]">{s.unitsSold} units · {s.items.length} lines</td>
                      <td><Badge tone="neutral">{pmLabel(s.paymentMethod)}</Badge></td>
                      <td className="num"><Money value={s.total} className="text-[13.5px] font-bold" /></td>
                      <td>{s.status === "VOID" ? <Badge tone="bad">voided</Badge> : <Badge tone="ok">completed</Badge>}</td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <Menu align="right" button={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.txn}`}>⋯</Button>}
                          items={[
                            { label: "Details", icon: <Receipt size={14} />, onClick: () => upd({ open: s.id }) },
                            { label: "Receipt", icon: <Receipt size={14} />, onClick: () => setReceipt(s) },
                            { label: "Void sale…", icon: <Ban size={14} />, danger: true, disabled: !can("sales.void") || s.status === "VOID" || !online, onClick: () => { setVoiding(s); setVoidReason(""); } },
                          ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 md:hidden">
            {data.paged.rows.map((s) => (
              <button key={s.id} className="card-flat card-hover p-3.5 text-left" onClick={() => upd({ open: s.id })}>
                <div className="flex items-center justify-between gap-2">
                  <span className="mono text-[12px] font-bold text-[var(--accent-soft-fg)]">{s.txn}</span>
                  {s.status === "VOID" ? <Badge tone="bad">voided</Badge> : <Badge tone="ok">completed</Badge>}
                </div>
                <p className="mt-1 truncate text-[12.5px] text-[var(--muted)]">{s.customerName || s.items.map((i) => i.name).join(", ")}</p>
                <div className="mt-2 flex items-center justify-between">
                  <Money value={s.total} className="text-[16px] font-bold" />
                  <span className="mono text-[10.5px] text-[var(--faint)]">{fmtDate(s.createdAt, ws.timezone)}</span>
                </div>
              </button>
            ))}
          </div>

          <Pagination page={data.paged.page} pages={data.paged.pages} total={data.paged.total} noun="sales" onPage={(p) => upd({ page: String(p) })} />
        </>
      )}

      {/* sale detail sheet — immutable snapshots */}
      <Sheet open={!!sale} onClose={() => upd({ open: "" })} title={sale ? `${sale.txn}` : ""} sub={sale ? `${fmtDate(sale.createdAt, ws.timezone, true)} · served by ${sale.createdByName}` : undefined}>
        {sale && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {sale.status === "VOID" ? <Badge tone="bad">voided — stock restored</Badge> : <Badge tone="ok">completed</Badge>}
              <Badge tone="neutral">{pmLabel(sale.paymentMethod)}</Badge>
              {sale.customerName && <Badge tone="info">{sale.customerName}</Badge>}
            </div>
            <div className="overflow-hidden rounded-[12px] border border-[var(--border)]">
              <table className="tbl">
                <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Disc</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {sale.items.map((it, i) => (
                    <tr key={i}>
                      <td>
                        <span className="block text-[13px] font-semibold">{it.name}</span>
                        <span className="mono text-[10.5px] text-[var(--faint)]">{it.sku} · cost snapshot {cur.format(it.unitCost)}{it.overridden && " · price overridden"}</span>
                      </td>
                      <td className="num mono">{it.qty}</td>
                      <td className="num mono">{cur.format(it.soldPrice)}</td>
                      <td className="num mono text-[var(--muted)]">{it.lineDiscount > 0 ? `−${cur.format(it.lineDiscount)}` : "—"}</td>
                      <td className="num mono font-bold">{cur.format(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="inset-panel space-y-1.5 p-3.5 text-[13px]">
              <div className="flex justify-between"><span className="text-[var(--muted)]">Subtotal</span><Money value={sale.subtotal} /></div>
              {sale.orderDiscount > 0 && <div className="flex justify-between"><span className="text-[var(--muted)]">Order discount (pro-rata)</span><span style={{ color: "var(--negative)" }}>−<Money value={sale.orderDiscount} /></span></div>}
              <div className="flex justify-between"><span className="text-[var(--muted)]">COGS (snapshot)</span><Money value={sale.cogs} /></div>
              <div className="flex justify-between"><span className="text-[var(--muted)]">Gross profit</span><Money value={sale.grossProfit} className="font-bold" /></div>
              <div className="flex justify-between border-t border-[var(--border)] pt-1.5 font-display text-[16px] font-bold"><span>Total</span><Money value={sale.total} /></div>
              {sale.paymentMethod === "CASH" && (
                <div className="flex justify-between text-[12px] text-[var(--muted)]"><span>Paid {cur.format(sale.amountPaid)} · change {cur.format(sale.changeDue)}</span></div>
              )}
            </div>
            {sale.note && <p className="rounded-[10px] bg-[var(--surface2)] px-3 py-2 text-[12.5px] text-[var(--muted)]">Note: {sale.note}</p>}
            {sale.status === "VOID" && sale.voidReason && (
              <p className="rounded-[10px] px-3 py-2 text-[12.5px] font-medium" style={{ background: "color-mix(in srgb, var(--negative) 10%, transparent)", color: "var(--negative)" }}>
                Voided: {sale.voidReason}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setReceipt(sale)}><Receipt size={14} /> View receipt</Button>
              {can("sales.void") && sale.status !== "VOID" && (
                <Button variant="danger" size="sm" onClick={() => { setVoiding(sale); setVoidReason(""); }} disabled={!online}><Ban size={14} /> Void sale…</Button>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <Modal open={!!voiding} onClose={() => setVoiding(null)} title={`Void ${voiding?.txn}?`} width="max-w-md"
        sub="Restores all stock via REVERSAL movements and is written to the audit log. Financial history is never deleted."
        footer={<><Button variant="ghost" onClick={() => setVoiding(null)}>Cancel</Button><Button variant="danger" onClick={doVoid} disabled={voidReason.trim().length < 3}>Void sale</Button></>}>
        <Field label="Reason (required)" error={voidReason.trim().length > 0 && voidReason.trim().length < 3 ? "Give at least 3 characters" : undefined}>
          <TextArea rows={2} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Customer changed their mind" />
        </Field>
      </Modal>

      <SaleModal open={composer} onClose={() => setComposer(false)} />
      <ReceiptModal open={!!receipt} onClose={() => setReceipt(null)} sale={receipt} />
    </div>
  );
}
