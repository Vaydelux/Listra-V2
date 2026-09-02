import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2 } from "lucide-react";
import { useCurrency } from "../store";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------- buttons ---------------- */

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "soft" | "outline" | "ghost" | "danger";
  size?: "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  const sizeCls = size === "xs" ? "btn-xs" : size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : size === "icon" ? "btn-icon" : size === "icon-sm" ? "btn-icon btn-sm" : "";
  return (
    <button className={cx("btn", `btn-${variant}`, sizeCls, className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ---------------- form primitives ---------------- */

export function Field({ label, error, hint, children, htmlFor }: { label?: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? (
        <p className="field-err" role="alert"><AlertTriangle size={12} /> {error}</p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> { invalid?: boolean; }
export function Input({ invalid, className, ...rest }: InputProps) {
  return <input className={cx("input", invalid && "input-err", className)} {...rest} />;
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { invalid?: boolean; }
export function TextArea({ invalid, className, ...rest }: TextareaProps) {
  return <textarea className={cx("textarea", invalid && "input-err", className)} {...rest} />;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { invalid?: boolean; }
export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return <select className={cx("select", invalid && "input-err", className)} {...rest}>{children}</select>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full border transition-colors"
      style={checked ? { background: "var(--accent)", borderColor: "var(--accent)" } : { background: "var(--surface2)", borderColor: "var(--border)" }}
    >
      <span className={cx("inline-block h-[16px] w-[16px] transform rounded-full transition-transform", checked ? "translate-x-[20px]" : "translate-x-[3px]")}
        style={{ background: checked ? "var(--accent-fg)" : "var(--muted)" }} />
    </button>
  );
}

/* ---------------- badges & indicators ---------------- */

export type BadgeTone = "ok" | "warn" | "bad" | "neutral" | "accent" | "info";
const toneColor: Record<BadgeTone, string> = {
  ok: "var(--positive)", warn: "var(--warn)", bad: "var(--negative)",
  neutral: "var(--muted)", accent: "var(--accent-soft-fg)", info: "var(--info)",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  const c = toneColor[tone];
  return (
    <span className={cx("badge", className)} style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>
      {children}
    </span>
  );
}

export function StockBadge({ stock, reorder }: { stock: number; reorder: number }) {
  if (stock === 0) return <Badge tone="bad"><span className="h-1.5 w-1.5 rounded-full bg-current" /> Out of stock</Badge>;
  if (stock <= reorder) return <Badge tone="warn"><span className="h-1.5 w-1.5 rounded-full bg-current" /> Low · {stock}</Badge>;
  return <Badge tone="ok"><span className="h-1.5 w-1.5 rounded-full bg-current" /> {stock}</Badge>;
}

export function DeltaChip({ pct, good, label }: { pct: number; good: boolean; label?: string }) {
  const up = pct >= 0;
  const color = good ? "var(--positive)" : "var(--negative)";
  return (
    <span className="mono inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color }}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d={up ? "M5 1l4 5H1z" : "M5 9L1 4h8z"} fill="currentColor" /></svg>
      {Math.abs(pct).toFixed(1)}%{label ? <span className="font-sans font-medium text-[var(--faint)]">{label}</span> : null}
    </span>
  );
}

export function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  if (prev === 0 && cur === 0) return <span className="text-[11.5px] text-[var(--faint)]">no prior data</span>;
  if (prev === 0) return <span className="text-[11.5px] font-semibold text-[var(--positive)]">new</span>;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const good = invert ? pct <= 0 : pct >= 0;
  return <DeltaChip pct={pct} good={good} label="vs prev" />;
}

/* ---------------- money ---------------- */

export function Money({ value, className, sign }: { value: number; className?: string; sign?: boolean }) {
  const cur = useCurrency();
  return <span className={cx("mono", className)}>{cur.format(value, { sign })}</span>;
}

/* ---------------- KPI card ---------------- */

export function Kpi({ label, value, sub, delta, icon, tone }: {
  label: string; value: ReactNode; sub?: ReactNode; delta?: ReactNode; icon?: ReactNode; tone?: "accent" | "ok" | "bad";
}) {
  const accentBar = tone === "accent" ? "var(--accent)" : tone === "ok" ? "var(--positive)" : tone === "bad" ? "var(--negative)" : "var(--border-strong)";
  return (
    <div className="card-flat relative overflow-hidden px-4 py-3.5">
      <span className="absolute inset-y-3 left-0 w-[3px] rounded-full" style={{ background: accentBar }} />
      <div className="flex items-center justify-between gap-2 pl-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--faint)]">{label}</span>
        {icon && <span className="text-[var(--faint)]">{icon}</span>}
      </div>
      <div className="mt-1.5 pl-2 font-display text-[22px] font-bold leading-none tracking-tight">{value}</div>
      {(sub || delta) && <div className="mt-1.5 flex items-center gap-2 pl-2 text-[12px] text-[var(--muted)]">{delta}{sub}</div>}
    </div>
  );
}

/* ---------------- modal & sheet ---------------- */

function useDialogBehavior(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, sub, children, footer, width = "max-w-xl" }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string;
}) {
  useDialogBehavior(open, onClose);
  const titleId = useId();
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            role="dialog" aria-modal="true" aria-labelledby={titleId}
            className={cx("card relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-b-none sm:rounded-b-[var(--radius)]", width)}
            initial={{ y: 40, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 id={titleId} className="font-display text-[17px] font-bold leading-tight">{title}</h2>
                {sub && <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">{sub}</p>}
              </div>
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close dialog"><X size={17} /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3.5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Sheet({ open, onClose, title, sub, children, footer }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  useDialogBehavior(open, onClose);
  const titleId = useId();
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const fn = () => setDesktop(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/55" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            role="dialog" aria-modal="true" aria-labelledby={titleId}
            className={cx("card absolute flex flex-col overflow-hidden", desktop ? "inset-y-0 right-0 w-[520px] max-w-[92vw] rounded-none border-y-0 border-r-0" : "inset-x-0 bottom-0 max-h-[88vh] rounded-b-none")}
            initial={desktop ? { x: "100%" } : { y: "100%" }}
            animate={desktop ? { x: 0 } : { y: 0 }}
            exit={desktop ? { x: "100%" } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 id={titleId} className="font-display text-[17px] font-bold leading-tight">{title}</h2>
                {sub && <div className="mt-0.5 text-[12.5px] text-[var(--muted)]">{sub}</div>}
              </div>
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel"><X size={17} /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3.5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = "Confirm", requireText, busy }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; body: ReactNode;
  confirmLabel?: string; requireText?: string; busy?: boolean;
}) {
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(""); }, [open]);
  const blocked = !!requireText && text.trim() !== requireText;
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={blocked} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }>
      <div className="space-y-4">
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "color-mix(in srgb, var(--negative) 15%, transparent)", color: "var(--negative)" }}>
            <AlertTriangle size={16} />
          </span>
          <div className="text-[13.5px] leading-relaxed text-[var(--muted)]">{body}</div>
        </div>
        {requireText && (
          <Field label={`Type "${requireText}" to confirm`}>
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={requireText} autoComplete="off" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- dropdown menu (portal-based overlay) ----------------
   Fixed-positioned via portal so it never shifts table layout, never gets
   clipped by scroll containers, and floats above everything (z-95). */

export interface MenuItem { label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onClick: () => void; }

function useFloating(open: boolean, align: "left" | "right") {
  const btnRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const b = btnRef.current?.getBoundingClientRect();
      const p = panelRef.current?.getBoundingClientRect();
      if (!b) return;
      const pw = p?.width ?? 200;
      const ph = p?.height ?? 180;
      const up = b.bottom + ph + 10 > window.innerHeight - 12 && b.top - ph - 10 > 12;
      const top = up ? b.top - ph - 6 : b.bottom + 6;
      let left = align === "right" ? b.right - pw : b.left;
      left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));
      setPos({ top, left, up });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, align]);

  return { btnRef, panelRef, pos };
}

function useDismiss(open: boolean, close: () => void, btnRef: React.RefObject<HTMLDivElement | null>, panelRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close, btnRef, panelRef]);
}

export function Menu({ button, items, align = "right" }: { button: ReactNode; items: MenuItem[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const { btnRef, panelRef, pos } = useFloating(open, align);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, btnRef, panelRef);

  return (
    <div ref={btnRef} className="inline-block align-middle" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
      {button}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef} role="menu"
              className="card fixed z-[95] min-w-[195px] max-w-[270px] overflow-hidden py-1.5 shadow-2xl"
              style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999, visibility: "hidden" }}
              initial={{ opacity: 0, scale: 0.94, y: pos?.up ? 8 : -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              {items.map((it) => (
                <button
                  key={it.label} role="menuitem" disabled={it.disabled}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-medium transition-all duration-150 hover:translate-x-[2px] hover:bg-[var(--surface2)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
                  style={it.danger ? { color: "var(--negative)" } : undefined}
                  onClick={() => { setOpen(false); it.onClick(); }}
                >
                  {it.icon}{it.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

/* ---------------- combobox (searchable select) ---------------- */

export interface ComboItem { id: string; title: string; sub?: string; right?: ReactNode; disabled?: boolean; }

export function Combobox({ items, onPick, placeholder, autoFocus }: {
  items: ComboItem[]; onPick: (item: ComboItem) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const filtered = items.filter((i) => !q || i.title.toLowerCase().includes(q.toLowerCase()) || (i.sub ?? "").toLowerCase().includes(q.toLowerCase()));
  useEffect(() => setActive(0), [q, open]);
  return (
    <div className="relative">
      <Input
        value={q} autoFocus={autoFocus} placeholder={placeholder ?? "Search…"} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 140)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter" && filtered[active]) { e.preventDefault(); onPick(filtered[active]); setQ(""); setOpen(false); }
        }}
      />
      <AnimatePresence>
        {open && filtered.length > 0 && (
          <motion.div className="card absolute z-40 mt-1.5 max-h-[260px] w-full overflow-y-auto py-1"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
            {filtered.map((it, i) => (
              <button key={it.id} type="button" disabled={it.disabled}
                className={cx("flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px]", i === active && "bg-[var(--surface2)]", it.disabled && "opacity-40")}
                onMouseEnter={() => setActive(i)}
                onClick={() => { onPick(it); setQ(""); setOpen(false); }}>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{it.title}</span>
                  {it.sub && <span className="block truncate text-[11.5px] text-[var(--muted)]">{it.sub}</span>}
                </span>
                {it.right}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- structural ---------------- */

export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[26px] font-bold leading-none tracking-tight">{title}</h1>
        {sub && <p className="mt-1.5 text-[13px] text-[var(--muted)]">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id} className="chip" aria-pressed={active === t.id} onClick={() => onChange(t.id)}>
          {t.label}
          {typeof t.count === "number" && <span className="mono text-[11px] opacity-70">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card-flat flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface2)] text-[var(--faint)]">
        {icon ?? <Inbox size={22} />}
      </span>
      <p className="font-display text-[15.5px] font-bold">{title}</p>
      {body && <p className="max-w-[380px] text-[13px] leading-relaxed text-[var(--muted)]">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="skel h-4" style={{ width: `${30 + ((i * 13) % 25)}%` }} />
          <div className="skel h-4 w-16" />
          <div className="skel h-4 flex-1" />
          <div className="skel h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage, noun = "records" }: { page: number; pages: number; total: number; onPage: (p: number) => void; noun?: string }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-3">
      <span className="text-[12px] text-[var(--faint)]">{total} {noun} · page {page} of {pages}</span>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={15} /></Button>
      </div>
    </div>
  );
}
