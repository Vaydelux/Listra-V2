import { useEffect, useMemo, useState } from "react";
import { Plus, Pin, Pencil, Archive, StickyNote } from "lucide-react";
import { motion } from "framer-motion";
import { useApp, toast, openQuickAdd } from "../store";
import { listNotes, allNoteTags, toggleNotePin, archiveNote } from "../lib/data";
import { isAppError } from "../lib/types";
import type { Note } from "../lib/types";
import { renderMarkdown, relTime } from "../lib/format";
import { Button, Input, Badge, EmptyState, PageHeader, Menu, cx } from "../components/ui";
import { NoteModal, noteColorVar } from "../components/modals";

export default function Notes() {
  const { ws, tick, online } = useApp();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tag, setTag] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");
  const [editor, setEditor] = useState<{ open: boolean; note: Note | null }>({ open: false, note: null });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 180);
    return () => clearTimeout(t);
  }, [q]);

  const data = useMemo(() => {
    if (!ws) return null;
    return {
      notes: listNotes(ws.id, { q: debouncedQ, tag: tag || undefined, archived: view === "archived" }),
      tags: allNoteTags(ws.id),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, tick, debouncedQ, tag, view]);

  if (!ws || !data) return null;

  const pin = (n: Note) => {
    try { toggleNotePin(n.id); } catch (e) { toast(isAppError(e) ? e.message : "Failed", "error"); }
  };

  return (
    <div className="fade-up mx-auto max-w-[1240px]">
      <PageHeader title="Notes" sub="Team knowledge, pinned notes first — Markdown rendered through a sanitizer">
        <Button size="sm" onClick={() => setEditor({ open: true, note: null })} disabled={!online}><Plus size={15} /> New note</Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-[240px]">
          <Input placeholder="Search notes and tags…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
        </div>
        <div className="flex items-center gap-1.5">
          <button className="chip" aria-pressed={view === "active"} onClick={() => setView("active")}>Active</button>
          <button className="chip" aria-pressed={view === "archived"} onClick={() => setView("archived")}>Archived</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {data.tags.map((t) => (
            <button key={t} className="chip" aria-pressed={tag === t} onClick={() => setTag(tag === t ? "" : t)}>#{t}</button>
          ))}
        </div>
      </div>

      {data.notes.length === 0 ? (
        <EmptyState
          title={view === "archived" ? "No archived notes" : debouncedQ || tag ? "No notes match" : "No notes yet"}
          body={view === "archived" ? "Archived notes land here — nothing is ever deleted silently." : "Capture suppliers, recipes, schedules and ideas in safe Markdown."}
          icon={<StickyNote size={22} />}
          action={view === "active" ? <Button onClick={() => openQuickAdd("note")}><Plus size={15} /> Create note</Button> : undefined}
        />
      ) : (
        <div className="masonry">
          {data.notes.map((n, i) => (
            <motion.article
              key={n.id} layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.25), type: "spring", stiffness: 300, damping: 28 }}
              className={cx("card-flat card-hover overflow-hidden", n.archived && "opacity-60")}
              style={{ borderTop: `3px solid ${noteColorVar[n.color]}` }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display text-[15.5px] font-bold leading-snug">{n.title}</h2>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => pin(n)} aria-label={n.pinned ? "Unpin note" : "Pin note"} aria-pressed={n.pinned}
                      className={cx("rounded-lg p-1.5 transition-all hover:bg-[var(--surface2)]", n.pinned ? "text-[var(--warn)]" : "text-[var(--faint)]")}>
                      <Pin size={15} className={n.pinned ? "fill-current" : ""} />
                    </button>
                    <Menu align="right" button={<Button variant="ghost" size="icon-sm" aria-label={`Note actions: ${n.title}`}>⋯</Button>}
                      items={[
                        { label: "Edit", icon: <Pencil size={14} />, onClick: () => setEditor({ open: true, note: n }) },
                        { label: n.archived ? "Restore" : "Archive", icon: <Archive size={14} />, danger: !n.archived, onClick: () => { try { archiveNote(n.id); toast(n.archived ? "Note restored" : "Note archived"); } catch (e) { toast(isAppError(e) ? e.message : "Failed", "error"); } } },
                      ]} />
                  </div>
                </div>
                {n.pinned && <Badge tone="warn" className="mb-2 mt-1">Pinned</Badge>}
                <div
                  className="md-body mt-2 max-h-[220px] overflow-hidden text-[13px] leading-relaxed text-[var(--muted)]"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(n.body || "_Empty note_") }}
                />
                {n.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {n.tags.map((t) => (
                      <button key={t} className="chip h-[24px]! px-2.5! text-[11px]!" onClick={() => setTag(t)} aria-pressed={tag === t}>#{t}</button>
                    ))}
                  </div>
                )}
                <p className="mt-3 border-t border-[var(--border)] pt-2.5 text-[11px] text-[var(--faint)]">
                  {n.authorName} · updated {relTime(n.updatedAt)}
                </p>
              </div>
            </motion.article>
          ))}
        </div>
      )}

      <NoteModal open={editor.open} onClose={() => setEditor({ open: false, note: null })} note={editor.note} />
    </div>
  );
}
