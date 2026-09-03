import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Download, Pencil, Paperclip, FolderKanban, Wallet } from "lucide-react";
import { useApp, useCurrency, toast } from "../store";
import {
  listExpenses, listExpenseCategories, buildExpensesCsv, createExpenseCategory, archiveExpenseCategory,
} from "../lib/data";
import { isAppError } from "../lib/types";
import type { Expense } from "../lib/types";
import { downloadCsv } from "../lib/format";
import { Button, Input, Select, Badge, Money, Pagination, Modal, EmptyState, PageHeader, Menu } from "../components/ui";
import { ExpenseModal } from "../components/modals";

export default function Expenses() {
  const { ws, tick, can, online, user, role } = useApp();
  const cur = useCurrency();
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const cat = params.get("cat") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const sort = params.get("sort") ?? "date:desc";
  const page = Number(params.get("page") ?? "1");

  const upd = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === "date:desc") next.delete(k); else next.set(k, v);
    }
    if (patch.page === "1") next.delete("page");
    setParams(next, { replace: true });
  };

  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => { if (debouncedQ !== q) upd({ q: debouncedQ, page: "1" }); }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const [editor, setEditor] = useState<{ open: boolean; expense: Expense | null }>({ open: false, expense: null });
  const [catModal, setCatModal] = useState(false);
  const [viewing, setViewing] = useState<Expense | null>(null);

  const data = useMemo(() => {
    if (!ws) return null;
    const fromMs = from ? new Date(from + "T00:00:00Z").getTime() : undefined;
    const toMs = to ? new Date(to + "T00:00:00Z").getTime() + 86_400_000 : undefined;
    const [s, d] = sort.split(":");
    const paged = listExpenses(ws.id, { q, categoryId: cat || undefined, fromMs, toMs, sort: s as "date", dir: d as "desc", page, pageSize: 9 });
    const all = listExpenses(ws.id, { q, categoryId: cat || undefined, fromMs, toMs, pageSize: 10_000 });
    const cats = listExpenseCategories(ws.id);
    return {
      paged, cats,
      total: all.rows.reduce((x, e) => x + e.amount, 0),
      count: all.total,
      topCat: cats.filter((c) => c.total > 0).sort((a, b) => b.total - a.total)[0]?.name ?? "—",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, tick, q, cat, from, to, sort, page]);

  if (!ws || !data) return null;

  const catName = (id: string) => data.cats.find((c) => c.id === id)?.name ?? "Archived category";
  const canEdit = (e: Expense) => can("expenses.update") && (role !== "STAFF" || e.createdBy === user?.id);

  const exportCsv = () => {
    try {
      const { csv, filename } = buildExpensesCsv(ws.id);
      downloadCsv(filename, csv);
      toast("Expenses CSV exported");
    } catch (e) { toast(isAppError(e) ? e.message : "Export failed", "error"); }
  };

  return (
    <div className="fade-up mx-auto max-w-[1240px]">
      <PageHeader title="Expenses" sub="Operating costs tracked against gross profit for true net figures">
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!can("reports.export")}><Download size={14} /> CSV</Button>
        {can("expenses.categories.manage") && <Button variant="outline" size="sm" onClick={() => setCatModal(true)}><FolderKanban size={14} /> Categories</Button>}
        {can("expenses.create") && <Button size="sm" onClick={() => setEditor({ open: true, expense: null })} disabled={!online}><Plus size={15} /> Record expense</Button>}
      </PageHeader>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="card-flat px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[var(--faint)]">Filtered total</p>
          <p className="mt-1 font-display text-[20px] font-bold leading-none"><Money value={data.total} /></p>
        </div>
        <div className="card-flat px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[var(--faint)]">Entries</p>
          <p className="mono mt-1 font-display text-[20px] font-bold leading-none">{data.count}</p>
        </div>
        <div className="card-flat px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[var(--faint)]">Top category</p>
          <p className="mt-1 truncate font-display text-[16px] font-bold leading-none">{data.topCat}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-[220px]">
          <Input placeholder="Search vendor, note, ref…" value={debouncedQ} onChange={(e) => setDebouncedQ(e.target.value)} aria-label="Search expenses" />
        </div>
        <Select className="w-[180px]" value={cat} onChange={(e) => upd({ cat: e.target.value, page: "1" })} aria-label="Category filter">
          <option value="">All categories</option>
          {data.cats.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
          <Input type="date" className="w-[140px]" value={from} onChange={(e) => upd({ from: e.target.value, page: "1" })} aria-label="From date" />
          –
          <Input type="date" className="w-[140px]" value={to} onChange={(e) => upd({ to: e.target.value, page: "1" })} aria-label="To date" />
        </div>
        <Select className="w-[160px]" value={sort} onChange={(e) => upd({ sort: e.target.value, page: "1" })} aria-label="Sort">
          <option value="date:desc">Newest first</option>
          <option value="date:asc">Oldest first</option>
          <option value="amount:desc">Amount: high → low</option>
          <option value="amount:asc">Amount: low → high</option>
        </Select>
      </div>

      {data.paged.total === 0 ? (
        <EmptyState title="No expenses found" body="Record operating costs here — they feed straight into net profit on the dashboard and reports."
          action={can("expenses.create") ? <Button onClick={() => setEditor({ open: true, expense: null })}><Plus size={15} /> Record expense</Button> : undefined} icon={<Wallet size={22} />} />
      ) : (
        <>
          <div className="card-flat hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Category</th><th>Vendor / note</th><th>Ref</th><th>Attachment</th><th className="num">Amount</th><th>By</th><th className="num">Actions</th></tr></thead>
                <tbody>
                  {data.paged.rows.map((e) => (
                    <tr key={e.id}>
                      <td className="mono text-[12.5px] text-[var(--muted)]">{e.date}</td>
                      <td><Badge tone="neutral">{catName(e.categoryId)}</Badge></td>
                      <td>
                        <span className="block max-w-[220px] truncate text-[13px] font-semibold">{e.vendor || "—"}</span>
                        {e.note && <span className="block max-w-[220px] truncate text-[11.5px] text-[var(--faint)]">{e.note}</span>}
                      </td>
                      <td className="mono text-[11.5px] text-[var(--muted)]">{e.reference || "—"}</td>
                      <td>
                        {e.attachment ? (
                          <Button variant="ghost" size="xs" onClick={() => setViewing(e)}><Paperclip size={12} /> {e.attachment.name.slice(0, 14)}</Button>
                        ) : <span className="text-[12px] text-[var(--faint)]">—</span>}
                      </td>
                      <td className="num"><Money value={e.amount} className="text-[13.5px] font-bold" /></td>
                      <td className="text-[12px] text-[var(--muted)]">{e.createdByName}</td>
                      <td className="num">
                        <Menu align="right" button={<Button variant="ghost" size="icon-sm" aria-label="Expense actions">⋯</Button>}
                          items={[{ label: "Edit", icon: <Pencil size={14} />, disabled: !canEdit(e), onClick: () => setEditor({ open: true, expense: e }) }]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 md:hidden">
            {data.paged.rows.map((e) => (
              <button key={e.id} className="card-flat card-hover p-3.5 text-left" onClick={() => canEdit(e) && setEditor({ open: true, expense: e })}>
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="neutral">{catName(e.categoryId)}</Badge>
                  <span className="mono text-[11px] text-[var(--faint)]">{e.date}</span>
                </div>
                <p className="mt-1.5 truncate text-[13.5px] font-semibold">{e.vendor || e.note || e.reference || "Expense"}</p>
                <p className="mt-1 font-display text-[17px] font-bold"><Money value={e.amount} /></p>
              </button>
            ))}
          </div>

          <Pagination page={data.paged.page} pages={data.paged.pages} total={data.paged.total} noun="expenses" onPage={(p) => upd({ page: String(p) })} />
        </>
      )}

      <ExpenseModal open={editor.open} onClose={() => setEditor({ open: false, expense: null })} expense={editor.expense} />
      <ExpenseCategoryModal open={catModal} onClose={() => setCatModal(false)} />

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.attachment?.name ?? "Attachment"} width="max-w-lg">
        {viewing?.attachment && (
          <div className="space-y-3">
            {viewing.attachment.mime.startsWith("image/") ? (
              <img src={viewing.attachment.dataUrl} alt={viewing.attachment.name} className="max-h-[52vh] w-full rounded-[10px] object-contain" style={{ background: "var(--field)" }} />
            ) : (
              <div className="inset-panel p-4 text-center text-[13px] text-[var(--muted)]">
                PDF preview — <a className="font-semibold text-[var(--accent-soft-fg)] underline" href={viewing.attachment.dataUrl} target="_blank" rel="noopener noreferrer">open in new tab</a>
              </div>
            )}
            <p className="text-[11.5px] text-[var(--faint)]">Private per-workspace storage · {Math.round(viewing.attachment.size / 1024)} KB · served via signed URL in production</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ExpenseCategoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ws, tick } = useApp();
  const cur = useCurrency();
  const [name, setName] = useState("");
  const cats = useMemo(() => (ws ? listExpenseCategories(ws.id) : []), [ws?.id, tick, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    try { createExpenseCategory(name); setName(""); toast("Expense category added"); }
    catch (e) { toast(isAppError(e) ? e.message : "Failed", "error"); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Expense categories" sub="Historical expenses keep their category reference; archiving hides a category from new entries." width="max-w-md">
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button onClick={add} disabled={!name.trim()}><Plus size={15} /> Add</Button>
        </div>
        <div className="space-y-1.5">
          {cats.map((c) => (
            <div key={c.id} className="inset-panel flex items-center justify-between gap-2 px-3 py-2">
              <span className="flex items-center gap-2 text-[13.5px] font-medium">
                {c.name}
                {c.isDefault && <Badge tone="accent">default</Badge>}
                {c.archived && <Badge tone="neutral">archived</Badge>}
              </span>
              <span className="flex items-center gap-2">
                <span className="mono text-[12px] text-[var(--muted)]">{cur.format(c.total)}</span>
                {!c.isDefault && (
                  <Button variant="ghost" size="xs" onClick={() => {
                    try { archiveExpenseCategory(c.id); toast(c.archived ? "Category restored" : "Category archived"); }
                    catch (e) { toast(isAppError(e) ? e.message : "Failed", "error"); }
                  }}>{c.archived ? "Restore" : "Archive"}</Button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
