import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

export interface ShredGroup { label: string; n: number; icon: ReactNode; tint: string; }

interface Strip { id: number; x: number; rot: number; h: number; delay: number; tint: string; }
interface Doc { id: number; group: ShredGroup; rot: number; }

let stripSeq = 1;

function buildQueue(groups: ShredGroup[], total: number, docCount: number): Doc[] {
  const q: Doc[] = [];
  if (total <= 0 || groups.length === 0) return q;
  let gi = 0;
  for (let i = 0; i < docCount; i++) {
    const g = groups[gi % groups.length];
    gi++;
    q.push({ id: i, group: g, rot: (i % 2 === 0 ? -1 : 1) * (1.2 + (i % 3)) });
  }
  return q;
}

export function ShredderOverlay({ open, title, sub, groups, doneLabel, onDone }: {
  open: boolean; title: string; sub: string; groups: ShredGroup[]; doneLabel: string; onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const total = groups.reduce((s, g) => s + g.n, 0);
  const docCount = useMemo(() => Math.max(5, Math.min(18, total)), [total]);
  const perDoc = Math.max(1, Math.ceil(total / Math.max(docCount, 1)));
  const queue = useMemo(() => buildQueue(groups, total, docCount), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const [idx, setIdx] = useState(0);
  const [strips, setStrips] = useState<Strip[]>([]);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<"feed" | "done">("feed");

  // Parent re-renders on every ledger tick with a fresh closure; a ref keeps
  // the completion timers from being torn down mid-sequence.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  useEffect(() => {
    if (open) { setIdx(0); setStrips([]); setShown(0); setPhase("feed"); }
  }, [open]);

  useEffect(() => {
    if (!open || phase !== "feed") return;
    if (total === 0) { setPhase("done"); return; }
    const iv = setInterval(() => setIdx((i) => (i >= queue.length ? i : i + 1)), reduced ? 90 : 340);
    return () => clearInterval(iv);
  }, [open, phase, queue.length, total, reduced]);

  useEffect(() => {
    if (!open || idx === 0 || idx > queue.length) return;
    const doc = queue[idx - 1];
    setShown((s) => Math.min(total, s + perDoc));
    if (!reduced) {
      const fresh: Strip[] = Array.from({ length: 7 }).map((_, k) => ({
        id: stripSeq++,
        x: 6 + ((idx * 13 + k * 29) % 88),
        rot: ((idx + k) % 2 === 0 ? -1 : 1) * (4 + ((k * 7) % 14)),
        h: 16 + ((idx * 5 + k * 11) % 18),
        delay: k * 0.045,
        tint: doc.group.tint,
      }));
      setStrips((s) => [...s.slice(-30), ...fresh]);
    }
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || phase !== "feed" || idx < queue.length) return;
    const t1 = setTimeout(() => setPhase("done"), reduced ? 250 : 750);
    const t2 = setTimeout(() => onDoneRef.current(), reduced ? 700 : 1900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [open, phase, idx, queue.length, reduced]);

  const progress = total === 0 ? 1 : shown / total;
  const next = queue.slice(idx, idx + 3);
  const feeding = queue[idx - 1];

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[110] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            role="alertdialog" aria-modal="true" aria-label={title}
            className="card relative w-full max-w-[420px] overflow-hidden"
            initial={{ scale: 0.94, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 14, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="pulse-dot h-2 w-2 rounded-full" style={{ background: phase === "done" ? "var(--positive)" : "var(--negative)" }} />
                <h2 className="font-display text-[16.5px] font-bold">{title}</h2>
              </div>
              <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">{sub}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {groups.map((g) => (
                  <span key={g.label} className="chip h-[24px]! cursor-default px-2.5! text-[11px]!">
                    <span style={{ color: g.tint }}>{g.icon}</span> {g.n} {g.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative mx-auto h-[330px] w-full overflow-hidden" style={{ background: "var(--field)" }}>
              <div className="absolute left-1/2 top-[6px] z-[5] -translate-x-1/2">
                {next.map((d, k) => (
                  <motion.div key={d.id} className="absolute left-1/2 -translate-x-1/2"
                    animate={{ y: k * -10, scale: 1 - k * 0.05, rotate: d.rot }}
                    transition={{ type: "spring", stiffness: 320, damping: 26 }}
                    style={{ zIndex: 10 - k, opacity: 1 - k * 0.22 }}>
                    <DocCard group={d.group} />
                  </motion.div>
                ))}
              </div>

              {feeding && phase === "feed" && (
                <motion.div key={`feed-${feeding.id}`} className="absolute left-1/2 top-[42px] z-[15] -translate-x-1/2"
                  initial={{ y: 0, opacity: 1, rotate: feeding.rot }}
                  animate={{ y: reduced ? 90 : 118, opacity: 0, rotate: 0 }}
                  transition={{ duration: reduced ? 0.08 : 0.34, ease: [0.5, 0, 0.75, 0.4] }}>
                  <DocCard group={feeding.group} />
                </motion.div>
              )}

              <motion.div
                className="absolute left-1/2 top-[150px] z-[20] h-[58px] w-[300px] -translate-x-1/2 rounded-[12px] border"
                style={{
                  borderColor: "var(--border-strong)",
                  background: "linear-gradient(180deg, color-mix(in srgb, var(--text) 14%, var(--surface)) 0%, var(--surface) 55%, color-mix(in srgb, var(--bg) 60%, var(--surface)) 100%)",
                  boxShadow: "var(--shadow-lg)",
                }}
                animate={phase === "feed" && !reduced ? { x: [0, -1, 1.2, -0.8, 0] } : { x: 0 }}
                transition={phase === "feed" && !reduced ? { repeat: Infinity, duration: 0.32, ease: "linear" } : { duration: 0.2 }}
              >
                <div className="flex items-center justify-between px-3.5 pt-2">
                  <span className="mono text-[9px] font-bold tracking-[0.18em] text-[var(--faint)]">LISTRA · LSR-900</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[8.5px] font-bold tracking-widest" style={{ color: phase === "done" ? "var(--positive)" : "var(--negative)" }}>
                      {phase === "done" ? "CLEAR" : "SHRED"}
                    </span>
                    <span
                      className={phase === "feed" ? "pulse-dot h-2 w-2 rounded-full" : "h-2 w-2 rounded-full"}
                      style={{ background: phase === "done" ? "var(--positive)" : "var(--negative)", boxShadow: `0 0 8px color-mix(in srgb, ${phase === "done" ? "var(--positive)" : "var(--negative)"} 70%, transparent)` }}
                    />
                  </span>
                </div>
                <div className="absolute inset-x-6 top-[30px] h-[9px] overflow-hidden rounded-[3px]" style={{ background: "var(--bg)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5)" }}>
                  <div className="h-full w-full" style={{ background: "repeating-linear-gradient(90deg, transparent 0 7px, color-mix(in srgb, var(--text) 26%, transparent) 7px 9px)" }} />
                </div>
              </motion.div>

              <div className="absolute left-1/2 top-[212px] z-[12] h-[104px] w-[240px] -translate-x-1/2">
                <AnimatePresence>
                  {strips.map((s) => (
                    <motion.span key={s.id} className="absolute top-0 w-[3px] rounded-full"
                      style={{ left: `${(s.x / 100) * 228 + 6}px`, height: s.h, background: `color-mix(in srgb, ${s.tint} 55%, var(--text))` }}
                      initial={{ y: 0, opacity: 0, rotate: 0 }}
                      animate={{ y: 96 - s.h * 0.4, opacity: [0, 1, 0.85], rotate: s.rot }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.55, delay: s.delay, ease: [0.3, 0.4, 0.6, 1] }}
                    />
                  ))}
                </AnimatePresence>
                <motion.div className="absolute inset-x-3 bottom-1.5 rounded-b-[8px]"
                  style={{
                    background: "repeating-linear-gradient(90deg, color-mix(in srgb, var(--text) 30%, var(--surface2)) 0 3px, color-mix(in srgb, var(--surface2) 80%, var(--text)) 3px 6px)",
                    border: "1px solid var(--border)",
                  }}
                  animate={{ height: 8 + progress * 52 }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>

              <div className="absolute left-1/2 top-[206px] z-[10] h-[116px] w-[264px] -translate-x-1/2 rounded-b-[14px] border border-t-0" style={{ borderColor: "var(--border-strong)", background: "color-mix(in srgb, var(--surface) 55%, transparent)" }} />

              <AnimatePresence>
                {phase === "done" && (
                  <motion.div className="absolute inset-0 z-[30] flex flex-col items-center justify-center gap-2"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    style={{ background: "color-mix(in srgb, var(--field) 78%, transparent)" }}>
                    <motion.span
                      initial={{ scale: 0.4, rotate: -14 }} animate={{ scale: 1, rotate: -6 }}
                      transition={{ type: "spring", stiffness: 300, damping: 16 }}
                      className="flex items-center gap-2 rounded-[10px] border-2 px-4 py-2 font-display text-[17px] font-bold uppercase tracking-[0.14em]"
                      style={{ borderColor: "var(--positive)", color: "var(--positive)", background: "color-mix(in srgb, var(--positive) 9%, var(--surface))" }}>
                      <CheckCircle2 size={19} /> {doneLabel}
                    </motion.span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="border-t border-[var(--border)] px-5 py-3.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold text-[var(--muted)]">{phase === "done" ? "All records destroyed — audit trail preserved" : "Shredding records…"}</span>
                <span className="mono font-bold">{Math.min(shown, total)} / {total}</span>
              </div>
              <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-[var(--surface2)]">
                <motion.div className="h-full rounded-full"
                  style={{ background: phase === "done" ? "var(--positive)" : "var(--accent)" }}
                  animate={{ width: `${Math.round(progress * 100)}%` }}
                  transition={{ type: "spring", stiffness: 140, damping: 24 }}
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DocCard({ group }: { group: ShredGroup }) {
  return (
    <div className="w-[124px] rounded-[8px] border px-2.5 py-2 shadow-md" style={{ background: "var(--surface)", borderColor: "var(--border-strong)" }}>
      <div className="flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-[6px]" style={{ background: `color-mix(in srgb, ${group.tint} 16%, transparent)`, color: group.tint }}>{group.icon}</span>
        <span className="truncate text-[10px] font-bold capitalize">{group.label.slice(0, -1)}</span>
      </div>
      <div className="mt-1.5 space-y-1">
        <div className="h-[3px] w-full rounded" style={{ background: "var(--border)" }} />
        <div className="h-[3px] w-3/4 rounded" style={{ background: "var(--border)" }} />
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {[3, 1, 2, 1, 3, 2, 1, 2].map((w, i) => (
          <span key={i} style={{ width: w * 2, height: 7, background: "color-mix(in srgb, var(--text) 55%, transparent)" }} />
        ))}
      </div>
    </div>
  );
}
