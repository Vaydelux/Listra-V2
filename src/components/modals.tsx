import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Printer, Paperclip } from "lucide-react";
import { useApp, useCurrency, toast } from "../store";
import {
  recordSale, createProduct, updateProduct, restockProduct, adjustStock,
  createExpense, updateExpense, listExpenseCategories, createNote, updateNote,
  listProducts, listCategoriesWithCounts,
} from "../lib/data";
import { isAppError } from "../lib/types";
import type { AppError, Product, Sale, Expense, Note, PaymentMethod, NoteColor } from "../lib/types";
import { PAYMENT_METHODS } from "../lib/types";
import { round2, fmtDate } from "../lib/format";
import { Button, Input, Field, Select, TextArea, Modal, Badge, Money, StockBadge, cx } from "./ui";

/* ---------------- helpers ---------------- */

function errOf(e: unknown): AppError {
  return isAppError(e) ? e : { code: "UNEXPECTED", message: "Something went wrong." };
}

function ErrBanner({ err }: { err: AppError | null }) {
  if (!err) return null;
  return (
    <div className="rounded-[10px] border px-3.5 py-2.5 text-[13px] font-medium" role="alert"
      style={{ borderColor: "color-mix(in srgb, var(--negative) 40%, transparent)", background: "color-mix(in srgb, var(--negative) 10%, transparent)", color: "var(--negative)" }}>
      {err.message}
    </div>
  );
}

/* ---------------- sale composer ---------------- */

interface Line { key: number; productId: string; qty: string; overridePrice: string; lineDiscount: string; }
let lineKey = 1;

export function SaleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ws, can, online, user } = useApp();
  const cur = useCurrency();
  const [lines, setLines] = useState<Line[]>([{ key: lineKey++, productId: "", qty: "1", overridePrice: "", lineDiscount: "" }]);
  const [orderDiscount, setOrderDiscount] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [amountPaid, setAmountPaid] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [productQuery, setProductQuery] = useState("");

  useEffect(() => {
    if (open) {
      setLines([{ key: lineKey++, productId: "", qty: "1", overridePrice: "", lineDiscount: "" }]);
      setOrderDiscount(""); setCustomerName(""); setCustomerContact(""); setMethod("CASH");
      setAmountPaid(""); setNote(""); setErr(null); setProductQuery("");
    }
  }, [open]);

  const products = useMemo(() => (ws ? listProducts(ws.id, { pageSize: 500 }).rows.filter((p) => !p.archived) : []), [ws?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => {
    let subtotal = 0;
    const detail = lines.map((l) => {
      const p = products.find((x) => x.id === l.productId);
      if (!p) return { line: l, product: null, lineTotal: 0 };
      const qty = Number(l.qty) || 0;
      const price = l.overridePrice !== "" ? Number(l.overridePrice) : p.sellingPrice;
      const disc = Number(l.lineDiscount) || 0;
      const lineTotal = round2(price * qty - disc);
      subtotal = round2(subtotal + lineTotal);
      return { line: l, product: p, price, qty, lineTotal };
    });
    const od = Number(orderDiscount) || 0;
    const total = round2(subtotal - od);
    return { detail, subtotal, od, total };
  }, [lines, orderDiscount, products]);

  const submit = () => {
    setErr(null); setBusy(true);
    setTimeout(() => {
      try {
        const s = recordSale({
          lines: lines.filter((l) => l.productId).map((l) => ({
            productId: l.productId,
            qty: Number(l.qty) || 0,
            overridePrice: l.overridePrice === "" ? null : Number(l.overridePrice),
            lineDiscount: Number(l.lineDiscount) || 0,
          })),
          orderDiscount: Number(orderDiscount) || 0,
          customerName, customerContact, paymentMethod: method,
          amountPaid: amountPaid === "" ? null : Number(amountPaid),
          note,
        });
        toast(`Sale ${s.txn} recorded`, "success", `Total ${cur.format(s.total)} · change ${cur.format(s.changeDue)}`);
        onClose();
      } catch (e) {
        setErr(errOf(e));
      } finally { setBusy(false); }
    }, 30);
  };

  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <Modal open={open} onClose={onClose} title="Record sale" sub="Previews are client-side — the ledger recomputes totals authoritatively" width="max-w-2xl"
      footer={
        <>
          <div className="mr-auto text-right">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)]">Total due</p>
            <p className="font-display text-[20px] font-bold leading-none"><Money value={preview.total} /></p>
          </div>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!online || lines.every((l) => !l.productId)}>Record sale</Button>
        </>
      }>
      <div className="space-y-4">
        <ErrBanner err={err} />

        {/* lines */}
        <div className="space-y-2.5">
          {lines.map((l, i) => {
            const p = products.find((x) => x.id === l.productId);
            return (
              <div key={l.key} className="inset-panel p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="mono text-[10.5px] font-bold text-[var(--faint)]">LINE {i + 1}</span>
                  {lines.length > 1 && (
                    <Button variant="ghost" size="icon-sm" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-[1fr_86px_110px_110px]">
                  <Select value={l.productId} onChange={(e) => set(l.key, { productId: e.target.value })} aria-label="Product">
                    <option value="">Select product…</option>
                    {products.map((pp) => (
                      <option key={pp.id} value={pp.id} disabled={pp.stock === 0}>
                        {pp.name} · {pp.sku} ({pp.stock} in stock)
                      </option>
                    ))}
                  </Select>
                  <Input type="number" min={1} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} aria-label="Quantity" />
                  <Input type="number" step="0.01" min={0} placeholder={p ? String(p.sellingPrice) : "Price"}
                    value={l.overridePrice} disabled={!can("sales.overridePrice")}
                    onChange={(e) => set(l.key, { overridePrice: e.target.value })}
                    aria-label="Price override"
                    title={can("sales.overridePrice") ? "Override price" : "Price override requires ADMIN"} />
                  <Input type="number" step="0.01" min={0} placeholder="Line disc." value={l.lineDiscount}
                    onChange={(e) => set(l.key, { lineDiscount: e.target.value })} aria-label="Line discount" />
                </div>
                {p && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--muted)]">
                    <StockBadge stock={p.stock} reorder={p.reorderLevel} />
                    <span className="mono">{p.stock} available</span>
                    {l.overridePrice !== "" && Number(l.overridePrice) !== p.sellingPrice && <Badge tone="warn">override</Badge>}
                  </div>
                )}
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { key: lineKey++, productId: "", qty: "1", overridePrice: "", lineDiscount: "" }])}>
            <Plus size={14} /> Add line
          </Button>
        </div>

        {/* order-level */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer name"><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in" /></Field>
          <Field label="Contact (optional)"><Input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} /></Field>
          <Field label="Payment method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Amount paid" hint={method === "CASH" ? "Leave blank for exact amount" : "For cash sales only"}>
            <Input type="number" step="0.01" min={0} value={amountPaid} disabled={method !== "CASH"} onChange={(e) => setAmountPaid(e.target.value)} />
          </Field>
          <Field label="Order discount" hint="Applied after line discounts, pro-rata across lines">
            <Input type="number" step="0.01" min={0} value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} />
          </Field>
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>

        {/* preview totals */}
        <div className="inset-panel space-y-1.5 p-3.5">
          {preview.detail.filter((d) => d.product).map((d) => (
            <div key={d.line.key} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="truncate text-[var(--muted)]">{d.product!.name} × {d.qty}</span>
              <span className="mono font-semibold"><Money value={d.lineTotal} /></span>
            </div>
          ))}
          <div className="r-dash border-t border-dashed border-[var(--border-strong)] pt-1.5" />
          <div className="flex items-center justify-between text-[12.5px]"><span className="text-[var(--muted)]">Subtotal</span><Money value={preview.subtotal} /></div>
          {preview.od > 0 && <div className="flex items-center justify-between text-[12.5px]"><span className="text-[var(--muted)]">Order discount</span><span className="mono" style={{ color: "var(--negative)" }}>−<Money value={preview.od} /></span></div>}
          <div className="flex items-center justify-between pt-1 font-display text-[17px] font-bold"><span>Total</span><Money value={preview.total} /></div>
          {method === "CASH" && amountPaid !== "" && Number(amountPaid) >= preview.total && (
            <div className="flex items-center justify-between text-[12.5px]"><span className="text-[var(--muted)]">Change due</span><Money value={round2(Number(amountPaid) - preview.total)} className="font-bold" /></div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- product create/edit ---------------- */

export function ProductModal({ open, onClose, product }: { open: boolean; onClose: () => void; product: Product | null }) {
  const { ws } = useApp();
  const [f, setF] = useState({ name: "", sku: "", categoryId: "" as string | null, description: "", costPrice: "", sellingPrice: "", stock: "0", reorderLevel: "0", unit: "pc", barcode: "" });
  const [err, setErr] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const cats = useMemo(() => (ws ? listCategoriesWithCounts(ws.id).filter((c) => !c.archived) : []), [ws?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) {
      setErr(null);
      setF(product
        ? { name: product.name, sku: product.sku, categoryId: product.categoryId, description: product.description, costPrice: String(product.costPrice), sellingPrice: String(product.sellingPrice), stock: String(product.stock), reorderLevel: String(product.reorderLevel), unit: product.unit, barcode: product.barcode }
        : { name: "", sku: "", categoryId: null, description: "", costPrice: "", sellingPrice: "", stock: "0", reorderLevel: "0", unit: "pc", barcode: "" });
    }
  }, [open, product]);

  const margin = Number(f.sellingPrice) > 0 && f.costPrice !== ""
    ? (((Number(f.sellingPrice) - Number(f.costPrice)) / Number(f.sellingPrice)) * 100).toFixed(1)
    : null;

  const submit = () => {
    setErr(null); setBusy(true);
    setTimeout(() => {
      try {
        const input = {
          name: f.name, sku: f.sku, categoryId: f.categoryId, description: f.description,
          costPrice: Number(f.costPrice) || 0, sellingPrice: Number(f.sellingPrice) || 0,
          stock: Number(f.stock) || 0, reorderLevel: Number(f.reorderLevel) || 0, unit: f.unit, barcode: f.barcode,
        };
        if (product) { updateProduct(product.id, input); toast("Product updated"); }
        else { createProduct(input); toast("Product created — opening stock recorded as RESTOCK"); }
        onClose();
      } catch (e) { setErr(errOf(e)); } finally { setBusy(false); }
    }, 30);
  };

  return (
    <Modal open={open} onClose={onClose} title={product ? "Edit product" : "New product"} width="max-w-xl"
      sub={product ? "History snapshots mean edits never restate past profit" : "Opening stock writes a RESTOCK movement"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>{product ? "Save changes" : "Create product"}</Button></>}>
      <div className="space-y-3.5">
        <ErrBanner err={err} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="SKU"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} placeholder="BEV-001" className="mono" /></Field>
          <Field label="Category">
            <Select value={f.categoryId ?? ""} onChange={(e) => setF({ ...f, categoryId: e.target.value || null })}>
              <option value="">Uncategorized</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Barcode (optional)"><Input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} className="mono" /></Field>
          <Field label="Cost price"><Input type="number" step="0.01" min={0} value={f.costPrice} onChange={(e) => setF({ ...f, costPrice: e.target.value })} /></Field>
          <Field label="Selling price" hint={margin !== null ? `Margin ${margin}%` : undefined}>
            <Input type="number" step="0.01" min={0} value={f.sellingPrice} onChange={(e) => setF({ ...f, sellingPrice: e.target.value })} />
          </Field>
          <Field label="Opening stock" hint={product ? "Stock changes go through restock/adjust" : undefined}>
            <Input type="number" min={0} value={f.stock} disabled={!!product} onChange={(e) => setF({ ...f, stock: e.target.value })} />
          </Field>
          <Field label="Reorder level"><Input type="number" min={0} value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} /></Field>
        </div>
        <Field label="Description"><TextArea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/* ---------------- restock & adjust ---------------- */

export function RestockModal({ open, onClose, productId }: { open: boolean; onClose: () => void; productId: string | null }) {
  const { ws } = useApp();
  const cur = useCurrency();
  const [pid, setPid] = useState(productId ?? "");
  const [qty, setQty] = useState("10");
  const [cost, setCost] = useState("");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const products = useMemo(() => (ws ? listProducts(ws.id, { pageSize: 500 }).rows.filter((p) => !p.archived) : []), [ws?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) { setPid(productId ?? ""); setQty("10"); setCost(""); setRef(""); setErr(null); }
  }, [open, productId]);

  const submit = () => {
    setErr(null); setBusy(true);
    setTimeout(() => {
      try {
        restockProduct({ productId: pid, quantity: Number(qty), currentCost: cost === "" ? null : Number(cost), reference: ref });
        toast("Restock recorded with movement entry");
        onClose();
      } catch (e) { setErr(errOf(e)); } finally { setBusy(false); }
    }, 30);
  };

  return (
    <Modal open={open} onClose={onClose} title="Restock product" sub="Atomic — stock and its movement ledger update together" width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!pid}>Restock</Button></>}>
      <div className="space-y-3.5">
        <ErrBanner err={err} />
        <Field label="Product">
          <Select value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">Choose…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.stock} on hand</option>)}
          </Select>
        </Field>
        <Field label="Quantity"><Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Current unit cost (optional)" hint="Updates the cost basis when supplied">
          <Input type="number" step="0.01" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder={cur.format(0)} />
        </Field>
        <Field label="Reference / note"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="PO-1042 · Monday delivery" /></Field>
      </div>
    </Modal>
  );
}

export function AdjustStockModal({ open, onClose, productId }: { open: boolean; onClose: () => void; productId: string }) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setDelta(""); setReason(""); setErr(null); } }, [open]);

  const submit = () => {
    setErr(null); setBusy(true);
    setTimeout(() => {
      try {
        adjustStock({ productId, delta: Number(delta), reason });
        toast("Adjustment recorded with movement entry");
        onClose();
      } catch (e) { setErr(errOf(e)); } finally { setBusy(false); }
    }, 30);
  };

  return (
    <Modal open={open} onClose={onClose} title="Adjust stock" sub="ADMIN-only · every adjustment is audited" width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={submit} loading={busy} disabled={!delta || !reason}>Apply adjustment</Button></>}>
      <div className="space-y-3.5">
        <ErrBanner err={err} />
        <Field label="Delta" hint="Negative removes stock (spoilage, shrink), positive adds (found stock)">
          <Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="-2" className="mono" />
        </Field>
        <Field label="Reason (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cycle count variance" /></Field>
      </div>
    </Modal>
  );
}

/* ---------------- expense ---------------- */

export function ExpenseModal({ open, onClose, expense }: { open: boolean; onClose: () => void; expense: Expense | null }) {
  const { ws } = useApp();
  const [f, setF] = useState({ amount: "", date: new Date().toISOString().slice(0, 10), categoryId: "", vendor: "", note: "", reference: "" });
  const [attachment, setAttachment] = useState<{ name: string; mime: string; size: number; dataUrl: string } | null>(null);
  const [err, setErr] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const cats = useMemo(() => (ws ? listExpenseCategories(ws.id).filter((c) => !c.archived || c.id === expense?.categoryId) : []), [ws?.id, open, expense?.categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) {
      setErr(null); setAttachment(expense?.attachment ?? null);
      setF(expense
        ? { amount: String(expense.amount), date: expense.date, categoryId: expense.categoryId, vendor: expense.vendor, note: expense.note, reference: expense.reference }
        : { amount: "", date: new Date().toISOString().slice(0, 10), categoryId: cats[0]?.id ?? "", vendor: "", note: "", reference: "" });
    }
  }, [open, expense, cats]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
      setErr({ code: "VALIDATION", message: "Only JPG, PNG, WEBP or PDF receipts are allowed." });
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      setErr({ code: "VALIDATION", message: "Receipt is too large (max 1.5 MB in this demo)." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAttachment({ name: file.name.replace(/[^\w.\- ]/g, "_"), mime: file.type, size: file.size, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const submit = () => {
    setErr(null); setBusy(true);
    setTimeout(() => {
      try {
        const input = { amount: Number(f.amount) || 0, date: f.date, categoryId: f.categoryId, vendor: f.vendor, note: f.note, reference: f.reference };
        if (expense) { updateExpense(expense.id, input); toast("Expense updated"); }
        else { createExpense({ ...input, attachment }); toast("Expense recorded"); }
        onClose();
      } catch (e) { setErr(errOf(e)); } finally { setBusy(false); }
    }, 30);
  };

  return (
    <Modal open={open} onClose={onClose} title={expense ? "Edit expense" : "Record expense"} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>{expense ? "Save changes" : "Record expense"}</Button></>}>
      <div className="space-y-3.5">
        <ErrBanner err={err} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount"><Input type="number" step="0.01" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Category">
            <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Vendor / payee"><Input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="Meralco" /></Field>
          <Field label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="OR-2031" className="mono" /></Field>
        </div>
        <Field label="Note"><TextArea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <Field label="Receipt (private storage in production)">
          <div className="flex items-center gap-2.5">
            <label className="btn btn-outline btn-sm cursor-pointer">
              <Paperclip size={13} /> Attach file
              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {attachment && (
              <span className="chip h-[26px]! px-2.5! text-[11px]!">
                {attachment.name.slice(0, 22)} · {Math.round(attachment.size / 1024)} KB
                <button onClick={() => setAttachment(null)} aria-label="Remove attachment" className="ml-1 text-[var(--faint)] hover:text-[var(--negative)]"><Trash2 size={11} /></button>
              </span>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------- note ---------------- */

export const noteColorVar: Record<NoteColor, string> = {
  gold: "var(--warn)", green: "var(--positive)", red: "var(--negative)", blue: "var(--info)", violet: "var(--chart-5)",
};

export function NoteModal({ open, onClose, note }: { open: boolean; onClose: () => void; note: Note | null }) {
  const [f, setF] = useState({ title: "", body: "", tags: "", color: "gold" as NoteColor });
  const [err, setErr] = useState<AppError | null>(null);

  useEffect(() => {
    if (open) {
      setErr(null);
      setF(note ? { title: note.title, body: note.body, tags: note.tags.join(", "), color: note.color } : { title: "", body: "", tags: "", color: "gold" });
    }
  }, [open, note]);

  const submit = () => {
    setErr(null);
    try {
      const input = { title: f.title, body: f.body, tags: f.tags.split(","), color: f.color };
      if (note) { updateNote(note.id, input); toast("Note updated"); }
      else { createNote(input); toast("Note created"); }
      onClose();
    } catch (e) { setErr(errOf(e)); }
  };

  return (
    <Modal open={open} onClose={onClose} title={note ? "Edit note" : "New note"} sub="Markdown supported — raw HTML is sanitized out" width="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!f.title.trim()}>{note ? "Save" : "Create note"}</Button></>}>
      <div className="space-y-3.5">
        <ErrBanner err={err} />
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Content"><TextArea rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={"## Supplier\n- **Café Rico** delivery Tue/Fri"} className="mono text-[12.5px]" /></Field>
        <Field label="Tags" hint="Comma separated"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="suppliers, ops" /></Field>
        <Field label="Accent color">
          <div className="flex gap-2 pt-1">
            {(Object.keys(noteColorVar) as NoteColor[]).map((c) => (
              <button key={c} onClick={() => setF({ ...f, color: c })} aria-label={`Color ${c}`} aria-pressed={f.color === c}
                className={cx("h-7 w-7 rounded-full border-2 transition-transform hover:scale-110", f.color === c ? "scale-110" : "border-transparent")}
                style={{ background: noteColorVar[c], borderColor: f.color === c ? "var(--text)" : "transparent" }} />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------- receipt ---------------- */

export function ReceiptModal({ open, onClose, sale }: { open: boolean; onClose: () => void; sale: Sale | null }) {
  const { ws } = useApp();
  const cur = useCurrency();
  if (!sale || !ws) return null;
  const pm = PAYMENT_METHODS.find((m) => m.value === sale.paymentMethod)?.label ?? sale.paymentMethod;

  return (
    <Modal open={open} onClose={onClose} title="Receipt" sub={`${sale.txn} · ${fmtDate(sale.createdAt, ws.timezone, true)}`} width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}><Printer size={14} /> Print</Button>
        </>
      }>
      <div className="receipt mx-auto max-w-[300px] rounded-[10px] border border-dashed border-[var(--border-strong)] p-4" style={{ background: "var(--field)" }}>
        <p className="text-center font-bold uppercase tracking-wide">{ws.business.name}</p>
        {ws.business.address && <p className="text-center text-[10.5px] opacity-80">{ws.business.address}</p>}
        {ws.business.phone && <p className="text-center text-[10.5px] opacity-80">{ws.business.phone}</p>}
        <div className="r-dash" />
        <p className="flex justify-between"><span>Receipt</span><span>{sale.txn}</span></p>
        <p className="flex justify-between"><span>Date</span><span>{fmtDate(sale.createdAt, ws.timezone, true)}</span></p>
        {sale.customerName && <p className="flex justify-between"><span>Customer</span><span>{sale.customerName}</span></p>}
        <div className="r-dash" />
        {sale.items.map((it, i) => (
          <div key={i} className="mb-1.5">
            <p className="flex justify-between font-semibold"><span>{it.qty} × {it.name}</span><span>{cur.format(it.subtotal)}</span></p>
            <p className="flex justify-between text-[10.5px] opacity-70">
              <span>{cur.format(it.soldPrice)}{it.overridden ? " (override)" : ""}{it.lineDiscount > 0 ? ` −${cur.format(it.lineDiscount)} disc` : ""}</span>
              <span className="mono">{it.sku}</span>
            </p>
          </div>
        ))}
        <div className="r-dash" />
        <p className="flex justify-between"><span>Subtotal</span><span>{cur.format(sale.subtotal)}</span></p>
        {sale.orderDiscount > 0 && <p className="flex justify-between"><span>Order discount</span><span>−{cur.format(sale.orderDiscount)}</span></p>}
        <p className="flex justify-between text-[14px] font-bold"><span>TOTAL</span><span>{cur.format(sale.total)}</span></p>
        <div className="r-dash" />
        <p className="flex justify-between"><span>Payment</span><span>{pm}</span></p>
        {sale.paymentMethod === "CASH" && (
          <>
            <p className="flex justify-between"><span>Cash</span><span>{cur.format(sale.amountPaid)}</span></p>
            <p className="flex justify-between"><span>Change</span><span>{cur.format(sale.changeDue)}</span></p>
          </>
        )}
        {sale.status === "VOID" && <p className="mt-2 text-center font-bold uppercase" style={{ color: "var(--negative)" }}>— VOIDED —<br /><span className="text-[10.5px] normal-case">{sale.voidReason}</span></p>}
        <div className="r-dash" />
        <p className="text-center text-[10.5px] opacity-80">{ws.business.receiptFooter}</p>
        {ws.business.taxId && <p className="text-center text-[10.5px] opacity-70">{ws.business.taxId}</p>}
        <p className="mt-2 text-center text-[9.5px] opacity-60">Served by {sale.createdByName} · generated by Listra</p>
      </div>
    </Modal>
  );
}
