import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Download, Pencil, PackagePlus, SlidersHorizontal, Boxes, Archive, Gauge } from "lucide-react";
import { useApp, useCurrency, toast } from "../store";
import {
  listProducts, listCategoriesWithCounts, movementsFor, productById,
  createProductCategory, archiveProductCategory, archiveProduct, buildProductsCsv,
} from "../lib/data";
import { isAppError } from "../lib/types";
import type { Product } from "../lib/types";
import { marginPct, markupPct, downloadCsv, fmtDate, relTime } from "../lib/format";
import {
  Button, Input, Select, Badge, StockBadge, Money, Pagination, Sheet, EmptyState, PageHeader, Menu, Tabs,
} from "../components/ui";
import { ProductModal, RestockModal, AdjustStockModal } from "../components/modals";

const SORTS = [
  { v: "created:desc", l: "Newest" }, { v: "name:asc", l: "Name A→Z" }, { v: "stock:asc", l: "Stock: low first" },
  { v: "price:desc", l: "Price: high first" }, { v: "margin:desc", l: "Margin: best first" },
];

export default function Inventory() {
  const { ws, tick, can, online } = useApp();
  const cur = useCurrency();
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const cat = params.get("cat") ?? "";
  const stock = params.get("stock") ?? "all";
  const sort = params.get("sort") ?? "created:desc";
  const page = Number(params.get("page") ?? "1");
  const openId = params.get("open");
  const tab = params.get("tab") ?? "products";

  const upd = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || (k === "stock" && v === "all") || (k === "sort" && v === "created:desc")) next.delete(k);
      else next.set(k, v);
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

  const [productModal, setProductModal] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [restock, setRestock] = useState<{ open: boolean; productId: string | null }>({ open: false, productId: null });
  const [adjust, setAdjust] = useState<string | null>(null);
  const [catModal, setCatModal] = useState(false);
  const [catName, setCatName] = useState("");

  const data = useMemo(() => {
    if (!ws) return null;
    const [s, d] = sort.split(":");
    return {
      paged: listProducts(ws.id, { q, categoryId: cat || undefined, stock: stock as "all" | "low" | "out", sort: s, dir: d as "asc" | "desc", page, pageSize: 9 }),
      cats: listCategoriesWithCounts(ws.id),
      open: openId ? productById(openId) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, tick, q, cat, stock, sort, page, openId]);

  if (!ws || !data) return null;
  const catNameById = (id: string | null) => data.cats.find((c) => c.id === id)?.name ?? "—";

  const exportCsv = () => {
    try {
      const { csv, filename } = buildProductsCsv(ws.id);
      downloadCsv(filename, csv);
      toast("Products CSV exported");
    } catch (e) { toast(isAppError(e) ? e.message : "Export failed", "error"); }
  };

  const addCat = () => {
    try { createProductCategory(catName); setCatName(""); toast("Category created"); }
    catch (e) { toast(isAppError(e) ? e.message : "Failed", "error"); }
  };

  return (
    <div className="fade-up mx-auto max-w-[1240px]">
      <PageHeader title="Inventory" sub={`${data.paged.total} products · stock changes always write a movement`}>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!can("reports.export")}><Download size={14} /> CSV</Button>
        <Button variant="outline" size="sm" onClick={() => setCatModal(true)}><Boxes size={14} /> Categories</Button>
        {can("stock.restock") && <Button variant="outline" size="sm" onClick={() => setRestock({ open: true, productId: null })} disabled={!online}><PackagePlus size={14} /> Restock</Button>}
        {can("inventory.create") && <Button size="sm" onClick={() => setProductModal({ open: true, product: null })} disabled={!online}><Plus size={15} /> New product</Button>}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs active={tab} onChange={(t) => upd({ tab: t })} tabs={[
          { id: "products", label: "Products", count: data.paged.total },
          { id: "low", label: "Needs attention", count: listProducts(ws.id, { stock: "low", pageSize: 1 }).total + listProducts(ws.id, { stock: "out", pageSize: 1 }).total },
        ]} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-[210px]">
            <Input placeholder="Search name, SKU, barcode…" value={debouncedQ} onChange={(e) => setDebouncedQ(e.target.value)} aria-label="Search products" />
          </div>
          <Select className="w-[160px]" value={cat} onChange={(e) => upd({ cat: e.target.value })} aria-label="Category filter">
            <option value="">All categories</option>
            {data.cats.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
          </Select>
          {tab === "products" && (
            <Select className="w-[140px]" value={stock} onChange={(e) => upd({ stock: e.target.value })} aria-label="Stock filter">
              <option value="all">All stock</option><option value="low">Low stock</option><option value="out">Out of stock</option>
            </Select>
          )}
          <Select className="w-[170px]" value={sort} onChange={(e) => upd({ sort: e.target.value })} aria-label="Sort products">
            {SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </Select>
        </div>
      </div>

      {data.paged.total === 0 ? (
        <EmptyState title="No products found" body="Add your first product — opening stock is recorded as a RESTOCK movement automatically."
          icon={<Boxes size={22} />}
          action={can("inventory.create") ? <Button onClick={() => setProductModal({ open: true, product: null })}><Plus size={15} /> New product</Button> : undefined} />
      ) : (
        <>
          <div className="card-flat hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th>Category</th><th className="num">Cost</th><th className="num">Price</th><th className="num">Margin</th><th>Stock</th><th className="num">Actions</th></tr></thead>
                <tbody>
                  {data.paged.rows.map((p) => (
                    <tr key={p.id} className="cursor-pointer" onClick={() => upd({ open: p.id })}>
                      <td>
                        <span className="block text-[13.5px] font-semibold">{p.name}</span>
                        <span className="mono text-[11px] text-[var(--faint)]">{p.sku}{p.archived && <Badge tone="neutral" className="ml-2">archived</Badge>}</span>
                      </td>
                      <td className="text-[12.5px] text-[var(--muted)]">{catNameById(p.categoryId)}</td>
                      <td className="num mono text-[12.5px] text-[var(--muted)]">{cur.format(p.costPrice)}</td>
                      <td className="num"><Money value={p.sellingPrice} className="text-[13px] font-bold" /></td>
                      <td className="num"><Badge tone={marginPct(p.sellingPrice, p.costPrice) >= 30 ? "ok" : marginPct(p.sellingPrice, p.costPrice) >= 10 ? "warn" : "bad"}>{marginPct(p.sellingPrice, p.costPrice).toFixed(0)}%</Badge></td>
                      <td><StockBadge stock={p.stock} reorder={p.reorderLevel} /></td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <Menu align="right" button={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`}>⋯</Button>}
                          items={[
                            { label: "Details & history", icon: <SlidersHorizontal size={14} />, onClick: () => upd({ open: p.id }) },
                            { label: "Restock", icon: <PackagePlus size={14} />, disabled: !can("stock.restock") || !online, onClick: () => setRestock({ open: true, productId: p.id }) },
                            { label: "Edit", icon: <Pencil size={14} />, disabled: !can("inventory.update") || !online, onClick: () => setProductModal({ open: true, product: p }) },
                            { label: can("inventory.adjust") ? "Adjust stock" : "Adjust (ADMIN)", icon: <Gauge size={14} />, disabled: !can("inventory.adjust") || !online, onClick: () => setAdjust(p.id) },
                            { label: p.archived ? "Restore" : "Archive", icon: <Archive size={14} />, danger: !p.archived, disabled: !can("inventory.update") || !online, onClick: () => { try { archiveProduct(p.id); toast(p.archived ? "Product restored" : "Product archived — history intact"); } catch (e) { toast(isAppError(e) ? e.message : "Failed", "error"); } } },
                          ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 md:hidden">
            {data.paged.rows.map((p) => (
              <button key={p.id} className="card-flat card-hover p-3.5 text-left" onClick={() => upd({ open: p.id })}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-bold">{p.name}</p>
                    <p className="mono text-[11px] text-[var(--faint)]">{p.sku} · {catNameById(p.categoryId)}</p>
                  </div>
                  <StockBadge stock={p.stock} reorder={p.reorderLevel} />
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <Money value={p.sellingPrice} className="text-[15px] font-bold" />
                  <Badge tone="neutral">margin {marginPct(p.sellingPrice, p.costPrice).toFixed(0)}%</Badge>
                </div>
              </button>
            ))}
          </div>

          <Pagination page={data.paged.page} pages={data.paged.pages} total={data.paged.total} noun="products" onPage={(p) => upd({ page: String(p) })} />
        </>
      )}

      <Sheet open={catModal} onClose={() => setCatModal(false)} title="Product categories" sub="Counts come from the ledger — never hand-maintained">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="New category name" onKeyDown={(e) => e.key === "Enter" && addCat()} />
            <Button onClick={addCat} disabled={!catName.trim()}><Plus size={15} /> Add</Button>
          </div>
          <div className="space-y-1.5">
            {data.cats.map((c) => (
              <div key={c.id} className="inset-panel flex items-center justify-between gap-2 px-3 py-2">
                <span className="flex items-center gap-2 text-[13.5px] font-medium">
                  {c.name} <span className="mono text-[11px] text-[var(--faint)]">{c.count} products</span>
                  {c.archived && <Badge tone="neutral">archived</Badge>}
                </span>
                <Button variant="ghost" size="xs" disabled={!can("inventory.update")}
                  onClick={() => { try { archiveProductCategory(c.id); toast(c.archived ? "Category restored" : "Category archived"); } catch (e) { toast(isAppError(e) ? e.message : "Reassign products first", "error"); } }}>
                  {c.archived ? "Restore" : "Archive"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </Sheet>

      <Sheet open={!!data.open} onClose={() => upd({ open: "" })} title={data.open?.name ?? ""} sub={data.open ? `${data.open.sku} · created ${fmtDate(data.open.createdAt, ws.timezone)}` : undefined}>
        {data.open && <ProductDetail p={data.open}
          onRestock={() => setRestock({ open: true, productId: data.open!.id })}
          onEdit={() => setProductModal({ open: true, product: data.open })}
          onAdjust={() => setAdjust(data.open!.id)} />}
      </Sheet>

      <ProductModal open={productModal.open} onClose={() => setProductModal({ open: false, product: null })} product={productModal.product} />
      <RestockModal open={restock.open} onClose={() => setRestock({ open: false, productId: null })} productId={restock.productId} />
      {adjust && <AdjustStockModal open onClose={() => setAdjust(null)} productId={adjust} />}
    </div>
  );
}

function ProductDetail({ p, onRestock, onEdit, onAdjust }: { p: Product; onRestock: () => void; onEdit: () => void; onAdjust: () => void }) {
  const cur = useCurrency();
  const { can, online } = useApp();
  const moves = useMemo(() => movementsFor(p.id), [p.id, p.stock]); // eslint-disable-line react-hooks/exhaustive-deps
  const MOVE_TONE = { RESTOCK: "ok", SALE: "info", REVERSAL: "warn", ADJUSTMENT: "bad", RETURN: "ok" } as const;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {([
          ["Cost", cur.format(p.costPrice)], ["Selling", cur.format(p.sellingPrice)],
          ["Unit profit", cur.format(p.sellingPrice - p.costPrice)],
          ["Margin", `${marginPct(p.sellingPrice, p.costPrice).toFixed(1)}%`],
          ["Markup", `${markupPct(p.sellingPrice, p.costPrice).toFixed(1)}%`],
          ["Reorder at", `${p.reorderLevel}`],
        ] as const).map(([l, v]) => (
          <div key={l} className="inset-panel px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--faint)]">{l}</p>
            <p className="mono mt-0.5 text-[15px] font-bold">{v}</p>
          </div>
        ))}
      </div>
      <p className="rounded-[10px] bg-[var(--surface2)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--muted)]">
        <strong className="text-[var(--text)]">Margin</strong> = (sell − cost) ÷ sell · <strong className="text-[var(--text)]">Markup</strong> = (sell − cost) ÷ cost. Sale history uses immutable cost snapshots, so editing these never restates past profit.
      </p>
      <div className="flex flex-wrap gap-2">
        {can("stock.restock") && <Button size="sm" onClick={onRestock} disabled={!online}><PackagePlus size={14} /> Restock</Button>}
        {can("inventory.update") && <Button variant="outline" size="sm" onClick={onEdit} disabled={!online}><Pencil size={14} /> Edit</Button>}
        {can("inventory.adjust") && <Button variant="outline" size="sm" onClick={onAdjust} disabled={!online}><Gauge size={14} /> Adjust</Button>}
      </div>
      <div>
        <h3 className="mb-2 font-display text-[14.5px] font-bold">Stock movement history</h3>
        {moves.length === 0 ? <p className="text-[13px] text-[var(--muted)]">No movements recorded.</p> : (
          <div className="space-y-1.5">
            {moves.slice(0, 30).map((m) => (
              <div key={m.id} className="inset-panel flex items-center justify-between gap-2 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge tone={MOVE_TONE[m.type]}>{m.type}</Badge>
                  <span className="min-w-0 truncate text-[12px] text-[var(--muted)]">{m.note} · {m.actorName}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <span className="mono text-[13px] font-bold" style={{ color: m.qty >= 0 ? "var(--positive)" : "var(--negative)" }}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
                  <span className="mono text-[10.5px] text-[var(--faint)]">{relTime(m.createdAt)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
