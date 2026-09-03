import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Boxes, ShoppingCart, Wallet, StickyNote, BarChart3, Settings, History,
  Search, Menu as MenuIcon, LogOut, Palette, Wifi, WifiOff, Plus, X, ChevronLeft, Command,
  PackagePlus, CircleDollarSign, PencilLine, User as UserIcon, Sun, Moon,
  CheckCircle2, AlertTriangle, Info,
} from "lucide-react";
import { useApp, useCurrency, useUi, useThemeStore, toast } from "../store";
import { logout, searchAll } from "../lib/data";
import type { SearchHit } from "../lib/data";
import { Button, cx, Badge } from "./ui";
import { THEMES, applyTheme } from "../lib/theme";
import { SaleModal, ProductModal, RestockModal, ExpenseModal, NoteModal } from "./modals";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export function ListraMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <path d="M21 14v28a8 8 0 0 0 8 8h15" fill="none" stroke="var(--accent-fg)" strokeWidth="7" strokeLinecap="round" />
      <circle cx="44" cy="18" r="5" fill="var(--accent-fg)" />
    </svg>
  );
}

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/sales", label: "Sales", icon: ShoppingCart },
  { to: "/expenses", label: "Expenses", icon: Wallet },
  { to: "/notes", label: "Notes", icon: StickyNote },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/audit", label: "Audit log", icon: History },
];

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard", "/inventory": "Inventory", "/sales": "Sales",
  "/expenses": "Expenses", "/notes": "Notes", "/reports": "Reports",
  "/settings": "Settings & administration", "/audit": "Audit log",
};

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { ws, user, role } = useApp();
  const loc = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col">
      <div className={cx("flex items-center gap-2.5 px-4 pb-4 pt-5", collapsed && "justify-center px-2")}>
        <ListraMark size={32} />
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-display text-[17px] font-bold leading-none tracking-tight">Listra</p>
            <p className="mt-0.5 truncate text-[11px] font-medium text-[var(--faint)]">{ws?.name}</p>
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5" aria-label="Main navigation">
        {NAV.map((n) => {
          const active = loc.pathname.startsWith(n.to);
          const Icon = n.icon;
          return (
            <Link
              key={n.to} to={n.to} onClick={onNavigate}
              className={cx(
                "group relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13.5px] font-semibold transition-all duration-150",
                active ? "text-[var(--accent-soft-fg)]" : "text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-[var(--text)]",
                collapsed && "justify-center px-0",
              )}
              style={active ? { background: "var(--accent-soft-bg)" } : undefined}
              title={collapsed ? n.label : undefined}
            >
              {active && <motion.span layoutId="nav-pill" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full" style={{ background: "var(--accent)" }} />}
              <Icon size={17} className="shrink-0" />
              {!collapsed && n.label}
            </Link>
          );
        })}
      </nav>

      <div className={cx("border-t border-[var(--border)] p-3", collapsed && "px-2")}>
        {!collapsed && role && (
          <p className="mb-2 px-0.5"><Badge tone={role === "STAFF" ? "info" : "accent"}>{role}</Badge></p>
        )}
        {!collapsed && (
          <p className="mb-2.5 rounded-lg px-2.5 py-2 text-[10.5px] font-medium leading-relaxed"
            style={{ background: "color-mix(in srgb, var(--warn) 10%, transparent)", color: "var(--warn)" }}
            title="This build stores all data in this browser only (localStorage). There is no hosted database, real email, or server-side enforcement. Do not use it for real money.">
            <span className="font-bold uppercase tracking-wide">Demo build</span> — data lives in this browser only, nothing is shared or backed up.
          </p>
        )}
        <div className={cx("flex items-center gap-2.5", collapsed && "justify-center")}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
            style={{ background: "var(--accent-soft-bg)", color: "var(--accent-soft-fg)" }}>
            {(user?.name ?? "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-bold leading-tight">{user?.name}</p>
              <p className="truncate text-[10.5px] text-[var(--faint)]">{user?.email}</p>
            </div>
          )}
          <button onClick={() => { logout(); }} aria-label="Sign out"
            className="rounded-lg p-2 text-[var(--faint)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--negative)]">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileDrawer() {
  const { drawerOpen, set } = useUi();
  const close = () => set({ drawerOpen: false });
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!drawerOpen) return;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [drawerOpen]);

  return (
    <AnimatePresence>
      {drawerOpen && (
        <motion.div className="fixed inset-0 z-[80] md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/60" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside
            role="dialog" aria-modal="true" aria-label="Navigation menu"
            className="absolute inset-y-0 left-0 w-[270px] overflow-hidden border-r"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <button ref={closeBtn} onClick={close} aria-label="Close menu"
              className="absolute right-3 top-4 z-10 rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface2)]">
              <X size={17} />
            </button>
            <SidebarContent collapsed={false} onNavigate={close} />
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const { themeId, setTheme } = useThemeStore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);

  const current = THEMES.find((t) => t.id === themeId);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-label="Choose theme" aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]">
        <Palette size={15} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="card absolute right-0 z-50 mt-1.5 grid w-[300px] grid-cols-2 gap-1 p-2.5"
            initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14 }}>
            <p className="col-span-2 px-1 pb-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--faint)]">
              19 themes · WCAG-derived contrast
            </p>
            <button
              className="flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[12px] font-semibold transition-colors hover:bg-[var(--surface2)] col-span-2"
              onClick={() => { setTheme("system"); applyTheme("system"); setOpen(false); }}>
              <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: "linear-gradient(90deg, #f4f5f7 50%, #0f1013 50%)", border: "1px solid var(--border-strong)" }} />
              System preference {themeId === "system" && <span className="ml-auto text-[10px] text-[var(--accent-soft-fg)]">active</span>}
            </button>
            <div className="col-span-2 max-h-[280px] overflow-y-auto pr-0.5">
              <div className="grid grid-cols-2 gap-1">
                {THEMES.map((t) => (
                  <button key={t.id} onClick={() => { setTheme(t.id); applyTheme(t.id); setOpen(false); }}
                    aria-pressed={themeId === t.id}
                    className={cx("flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[11.5px] font-semibold transition-colors hover:bg-[var(--surface2)]", themeId === t.id && "text-[var(--accent-soft-fg)]")}
                    style={themeId === t.id ? { background: "var(--accent-soft-bg)" } : undefined}>
                    <span className="h-4 w-4 shrink-0 rounded-full border" style={{ background: t.v.accent, borderColor: "var(--border-strong)" }} />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
            {current && (
              <p className="col-span-2 px-1 pt-1 text-[10px] text-[var(--faint)]">
                {current.dark ? "Dark" : "Light"} preset · accent {current.v.accent}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function QuickAddFab() {
  const { fabOpen, set, openQuickAdd } = useUi();
  const { can } = useApp();
  const actions = [
    { kind: "sale" as const, label: "New sale", icon: ShoppingCart, cap: "sales.create" as const },
    { kind: "product" as const, label: "Add product", icon: Plus, cap: "inventory.create" as const },
    { kind: "restock" as const, label: "Restock product", icon: PackagePlus, cap: "stock.restock" as const },
    { kind: "expense" as const, label: "Record expense", icon: CircleDollarSign, cap: "expenses.create" as const },
    { kind: "note" as const, label: "Create note", icon: PencilLine, cap: "notes.manage" as const },
  ].filter((a) => can(a.cap));

  return (
    <div className="no-print fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-[calc(1.25rem+env(safe-area-inset-right))] z-[60] flex flex-col items-end gap-2.5">
      <AnimatePresence>
        {fabOpen && actions.map((a, i) => (
          <motion.button
            key={a.kind}
            initial={{ opacity: 0, y: 12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={{ delay: i * 0.035, type: "spring", stiffness: 400, damping: 28 }}
            onClick={() => openQuickAdd(a.kind)}
            className="card flex items-center gap-2.5 py-2 pl-3 pr-4 text-[13px] font-semibold shadow-lg transition-colors hover:border-[var(--border-strong)]">
            <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "var(--accent-soft-bg)", color: "var(--accent-soft-fg)" }}>
              <a.icon size={14} />
            </span>
            {a.label}
          </motion.button>
        ))}
      </AnimatePresence>
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => set({ fabOpen: !fabOpen })}
        aria-label={fabOpen ? "Close quick actions" : "Quick add"} aria-expanded={fabOpen}
        className="flex h-14 w-14 items-center justify-center rounded-full shadow-lg"
        style={{ background: "var(--accent)", color: "var(--accent-fg)", boxShadow: "var(--shadow-lg)" }}>
        <motion.span animate={{ rotate: fabOpen ? 45 : 0 }} transition={{ duration: 0.18 }}>
          {fabOpen ? <X size={22} /> : <Plus size={24} />}
        </motion.span>
      </motion.button>
    </div>
  );
}

function GlobalModals() {
  const { quickAdd, quickAddProductId, closeQuickAdd } = useUi();
  return (
    <>
      <SaleModal open={quickAdd === "sale"} onClose={closeQuickAdd} />
      <ProductModal open={quickAdd === "product"} onClose={closeQuickAdd} product={null} />
      <RestockModal open={quickAdd === "restock"} onClose={closeQuickAdd} productId={quickAddProductId} />
      <ExpenseModal open={quickAdd === "expense"} onClose={closeQuickAdd} expense={null} />
      <NoteModal open={quickAdd === "note"} onClose={closeQuickAdd} note={null} />
    </>
  );
}

const TOAST_TTL: Record<string, number> = { success: 4200, info: 4600, error: 6400 };

export function Toaster() {
  const { toasts, dismissToast } = useUi();
  const [dockBottom, setDockBottom] = useState(() => window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const fn = () => setDockBottom(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  return (
    <div
      aria-live="polite" role="status"
      className={cx(
        "pointer-events-none fixed z-[120] flex flex-col gap-2.5 px-3.5",
        dockBottom
          ? "bottom-[calc(1.4rem+env(safe-area-inset-bottom))] right-5 w-[372px] max-w-[calc(100vw-2.5rem)] items-stretch"
          : "top-[calc(68px+env(safe-area-inset-top))] left-1/2 w-[calc(100vw-1.5rem)] max-w-[400px] -translate-x-1/2 items-stretch",
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {toasts.map((t) => {
          const color = t.tone === "success" ? "var(--positive)" : t.tone === "error" ? "var(--negative)" : "var(--info)";
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? AlertTriangle : Info;
          const label = t.tone === "success" ? "Saved" : t.tone === "error" ? "Action failed" : "Heads up";
          const ttl = TOAST_TTL[t.tone] ?? 4200;
          return (
            <motion.div
              key={t.id} layout
              initial={{ opacity: 0, y: dockBottom ? 26 : -26, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.93, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 440, damping: 33 }}
              className="card pointer-events-auto relative w-full overflow-hidden shadow-xl"
              style={{ borderColor: `color-mix(in srgb, ${color} 45%, var(--border-strong))`, boxShadow: "var(--shadow-lg)" }}
            >
              <div className="flex items-start gap-3 py-3 pl-3.5 pr-2.5">
                <span className="mt-[1px] flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
                  <Icon size={17} strokeWidth={2.4} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color }}>{label}</p>
                  <p className="mt-0.5 break-words text-[13.5px] font-semibold leading-snug">{t.message}</p>
                  {t.detail && <p className="mt-0.5 text-[12px] leading-snug text-[var(--muted)]">{t.detail}</p>}
                </div>
                <button onClick={() => dismissToast(t.id)} aria-label="Dismiss notification"
                  className="rounded-md p-1.5 text-[var(--faint)] transition-all hover:bg-[var(--surface2)] hover:text-[var(--text)] active:scale-90">
                  <X size={15} />
                </button>
              </div>
              <span aria-hidden="true" className="toastbar absolute inset-x-0 bottom-0 h-[3px] origin-left"
                style={{ background: color, animationDuration: `${ttl}ms` }} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function CommandPalette() {
  const { paletteOpen, set } = useUi();
  const { ws } = useApp();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 160);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { if (paletteOpen) { setQ(""); setDebounced(""); setActive(0); } }, [paletteOpen]);

  const hits = useMemo(() => (ws && debounced.trim().length >= 2 ? searchAll(ws.id, debounced) : []), [ws?.id, debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!paletteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") set({ paletteOpen: false });
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      if (e.key === "Enter" && hits[active]) go(hits[active]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, hits, active]);

  const go = (h: SearchHit) => {
    const dest = h.kind === "product" ? "/inventory" : h.kind === "sale" ? "/sales" : h.kind === "note" ? "/notes" : "/expenses";
    set({ paletteOpen: false });
    navigate(`${dest}?open=${h.id}`);
  };

  return (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div className="fixed inset-0 z-[85] flex items-start justify-center px-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => set({ paletteOpen: false })} />
          <motion.div role="dialog" aria-modal="true" aria-label="Global search"
            className="card relative w-full max-w-[560px] overflow-hidden"
            initial={{ y: -14, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -10, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}>
            <div className="flex items-center gap-3 border-b border-[var(--border)] px-4">
              <Search size={17} className="text-[var(--faint)]" />
              <input
                autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search products, receipts, notes, expenses…"
                className="h-[52px] w-full bg-transparent text-[14.5px] outline-none placeholder:text-[var(--faint)]"
                aria-label="Search everything"
              />
              <span className="kbd hidden sm:inline-flex">esc</span>
            </div>
            <div className="max-h-[46vh] overflow-y-auto p-2">
              {debounced.trim().length < 2 ? (
                <p className="px-3 py-6 text-center text-[12.5px] text-[var(--faint)]">
                  Type at least 2 characters — results are scoped to this workspace.
                </p>
              ) : hits.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12.5px] text-[var(--faint)]">No matches for “{debounced}”.</p>
              ) : (
                hits.map((h, i) => {
                  const Icon = h.kind === "product" ? Boxes : h.kind === "sale" ? ShoppingCart : h.kind === "note" ? StickyNote : Wallet;
                  return (
                    <button key={`${h.kind}-${h.id}`} onClick={() => go(h)} onMouseEnter={() => setActive(i)}
                      className={cx("flex w-full items-center gap-3 rounded-[9px] px-3 py-2.5 text-left", i === active && "bg-[var(--surface2)]")}>
                      <span className="flex h-8 w-8 items-center justify-center rounded-[8px]" style={{ background: "var(--accent-soft-bg)", color: "var(--accent-soft-fg)" }}>
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold">{h.title}</span>
                        <span className="block truncate text-[11.5px] text-[var(--faint)]">{h.sub}</span>
                      </span>
                      <Badge tone="neutral">{h.kind}</Badge>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { ws, user, online } = useApp();
  const { sidebarCollapsed, set } = useUi();
  const loc = useLocation();
  const cur = useCurrency();
  const title = TITLES[loc.pathname] ?? "Listra";

  // Ctrl/Cmd + K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        set({ paletteOpen: !useUi.getState().paletteOpen });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  useEffect(() => {
    if (!online) toast("You're offline — mutations are disabled until you reconnect.", "info");
  }, [online]);

  return (
    <div className="ambient flex h-screen overflow-hidden">
      <motion.aside
        className="no-print hidden shrink-0 overflow-hidden border-r md:block"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        animate={{ width: sidebarCollapsed ? 74 : 252 }}
        transition={{ type: "spring", stiffness: 340, damping: 34 }}
      >
        <SidebarContent collapsed={sidebarCollapsed} />
        <button
          onClick={() => set({ sidebarCollapsed: !sidebarCollapsed })}
          className="flex w-full items-center justify-center gap-2 border-t border-[var(--border)] py-2.5 text-[12px] font-semibold text-[var(--faint)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <ChevronLeft size={15} className={cx("transition-transform", sidebarCollapsed && "rotate-180")} />
          {!sidebarCollapsed && "Collapse"}
        </button>
      </motion.aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-40 border-b border-[var(--border)]" style={{ background: "color-mix(in srgb, var(--bg) 82%, transparent)", backdropFilter: "blur(12px)" }}>
          <div className="flex h-[58px] items-center gap-3 px-4 sm:px-6">
            <button className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-[var(--text)] md:hidden"
              onClick={() => set({ drawerOpen: true })} aria-label="Open menu"><MenuIcon size={19} /></button>
            <div className="min-w-0">
              <p className="hidden text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--faint)] sm:block">Listra / {ws?.name}</p>
              <h1 className="truncate font-display text-[16.5px] font-bold leading-tight">{title}</h1>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => set({ paletteOpen: true })}
                className="hidden h-9 items-center gap-2.5 rounded-[10px] border border-[var(--border)] px-3 text-[12.5px] font-medium text-[var(--faint)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] sm:flex"
                aria-label="Open global search">
                <Search size={14} /> Search… <span className="kbd flex items-center gap-0.5"><Command size={9} />K</span>
              </button>
              <button onClick={() => set({ paletteOpen: true })} aria-label="Open global search"
                className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] text-[var(--muted)] sm:hidden"><Search size={15} /></button>
              <span className="mono hidden h-9 items-center gap-1.5 rounded-[10px] border border-[var(--border)] px-3 text-[12px] font-semibold text-[var(--muted)] lg:flex" data-tip={`${cur.code} — presentation currency`}>
                {cur.code}
              </span>
              <span className={cx("hidden h-9 items-center gap-1.5 rounded-[10px] border px-2.5 text-[11.5px] font-bold md:flex", online ? "text-[var(--positive)]" : "text-[var(--warn)]")}
                style={{ borderColor: "var(--border)" }} role="status" aria-live="polite">
                {online ? <Wifi size={13} /> : <WifiOff size={13} />}
                {online ? "Online" : "Offline"}
              </span>
              <ThemeMenu />
            </div>
          </div>
          {!online && (
            <div className="flex items-center gap-2 px-4 py-1.5 text-[12px] font-semibold sm:px-6" style={{ background: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--warn)" }}>
              <WifiOff size={13} /> Offline mode — browsing works, but sales, stock and expense changes are disabled until you reconnect. Nothing is silently queued as “saved”.
            </div>
          )}
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">{children}</main>
        <footer className="no-print border-t border-[var(--border)] px-4 py-3 text-[11.5px] text-[var(--faint)] sm:px-6">
          Listra · local-first demo build — signed in as {user?.email} · all records scoped to workspace <span className="mono">{ws?.id.slice(0, 8)}</span>
        </footer>
      </div>

      <MobileDrawer />
      <QuickAddFab />
      <CommandPalette />
      <GlobalModals />
      <Toaster />
    </div>
  );
}
