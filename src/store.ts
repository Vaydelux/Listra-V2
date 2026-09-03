import { create } from "zustand";
import { useContext } from "react";
import { createContext } from "react";
import { makeFormatter } from "./lib/format";
import type { CurrencyFormatter } from "./lib/format";
import type { Profile, Session, Workspace, Role, Capability } from "./lib/types";
import { can as roleCan } from "./lib/types";

/* ---------------- ephemeral UI state (Zustand) ----------------
   UI-only by design: sidebar/drawer/palette/FAB/toasts/theme.
   Never store ledger entities here — the tick re-reads the engine. */

export interface Toast { id: number; message: string; tone: "success" | "error" | "info"; detail?: string; }
export type QuickAddKind = "sale" | "product" | "restock" | "expense" | "note" | null;

interface UiState {
  sidebarCollapsed: boolean;
  drawerOpen: boolean;
  paletteOpen: boolean;
  fabOpen: boolean;
  quickAdd: QuickAddKind;
  quickAddProductId: string | null;
  toasts: Toast[];
  set: (patch: Partial<UiState>) => void;
  toast: (message: string, tone?: Toast["tone"], detail?: string) => void;
  dismissToast: (id: number) => void;
  openQuickAdd: (kind: Exclude<QuickAddKind, null>, productId?: string | null) => void;
  closeQuickAdd: () => void;
}

let toastSeq = 1;

export const useUi = create<UiState>((setState) => ({
  sidebarCollapsed: false,
  drawerOpen: false,
  paletteOpen: false,
  fabOpen: false,
  quickAdd: null,
  quickAddProductId: null,
  toasts: [],
  set: (patch) => setState(patch),
  toast: (message, tone = "success", detail) => {
    const id = toastSeq++;
    setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone, detail }] }));
    // Errors linger longer — they carry decisions, not confirmations.
    const ttl = tone === "error" ? 6200 : 4200;
    setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttl);
  },
  dismissToast: (id) => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openQuickAdd: (kind, productId = null) => setState({ quickAdd: kind, quickAddProductId: productId, fabOpen: false }),
  closeQuickAdd: () => setState({ quickAdd: null, quickAddProductId: null }),
}));

export const toast = (message: string, tone: Toast["tone"] = "success", detail?: string): void => useUi.getState().toast(message, tone, detail);
export const openQuickAdd = (kind: Exclude<QuickAddKind, null>, productId?: string): void => useUi.getState().openQuickAdd(kind, productId);

/* ---------------- application context ---------------- */

export interface AppContextValue {
  tick: number;          // bump → re-read the ledger engine
  sessionReady: boolean;
  user: Profile | null;
  ws: Workspace | null;
  role: Role | null;
  session: Session | null;
  can: (cap: Capability) => boolean;
  online: boolean;
}

export const AppCtx = createContext<AppContextValue>({
  tick: 0, sessionReady: false, user: null, ws: null, role: null, session: null,
  can: () => false, online: true,
});

export function useApp(): AppContextValue {
  return useContext(AppCtx);
}

export function useCurrency(): CurrencyFormatter {
  const { ws } = useApp();
  return makeFormatter(ws?.currency ?? "PHP", ws?.locale ?? "en-PH");
}

/* ---------------- theme store ---------------- */

interface ThemeState { themeId: string; setTheme: (id: string) => void; reduceMotion: boolean; setReduceMotion: (v: boolean) => void; }

export const useThemeStore = create<ThemeState>((set) => ({
  themeId: localStorage.getItem("listra.theme") ?? "obsidian-gold",
  setTheme: (id) => {
    if (id === "system") localStorage.removeItem("listra.theme");
    else localStorage.setItem("listra.theme", id);
    set({ themeId: id });
  },
  reduceMotion: localStorage.getItem("listra.reduceMotion") === "1",
  setReduceMotion: (v) => {
    localStorage.setItem("listra.reduceMotion", v ? "1" : "0");
    set({ reduceMotion: v });
  },
}));

export { roleCan };
