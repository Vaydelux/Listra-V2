import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppCtx, useThemeStore } from "./store";
import { dbReady, subscribe, getSession, getCurrentUser, getWorkspace, getRole } from "./lib/data";
import { can as roleCan } from "./lib/types";
import type { Capability } from "./lib/types";
import { applyTheme } from "./lib/theme";
import { AppShell, useOnlineStatus, ListraMark } from "./components/shell";
import { AuthScreen, Onboarding } from "./components/auth";

const Dashboard = lazy(() => import("./modules/Dashboard"));
const Inventory = lazy(() => import("./modules/Inventory"));
const Sales = lazy(() => import("./modules/Sales"));
const Expenses = lazy(() => import("./modules/Expenses"));
const Notes = lazy(() => import("./modules/Notes"));
const Reports = lazy(() => import("./modules/Reports"));
const Settings = lazy(() => import("./modules/Settings"));
const AuditPage = lazy(() => import("./modules/Settings").then((m) => ({ default: m.AuditLog })));

function Splash() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <span className="pulse-dot"><ListraMark size={46} /></span>
      <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[var(--faint)]">Opening the ledger…</p>
    </div>
  );
}

function ModuleSkeleton() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-4">
      <div className="skel h-8 w-56" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skel h-[92px]" />)}
      </div>
      <div className="skel h-[280px]" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="skel h-[190px]" />)}
      </div>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  const online = useOnlineStatus();
  const themeId = useThemeStore((s) => s.themeId);
  const reduceMotion = useThemeStore((s) => s.reduceMotion);

  useEffect(() => {
    let cancelled = false;
    dbReady.then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  useEffect(() => { applyTheme(themeId); }, [themeId]);

  useEffect(() => {
    if (themeId !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => applyTheme("system");
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [themeId]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reduceMotion ? "1" : "0";
  }, [reduceMotion]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* offline caching unavailable */ });
    }
  }, []);

  // Identity is re-read on every ledger commit — the tick is the cache key.
  const session = ready ? getSession() : null;
  const user = ready ? getCurrentUser() : null;
  const ws = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  const role = ws && user ? getRole(ws.id, user.id) : null;

  const ctx = useMemo(() => ({
    tick, sessionReady: ready, user, ws, role, session,
    can: (cap: Capability) => (role ? roleCan(role, cap) : false),
    online,
  }), [tick, ready, user, ws, role, session, online]);

  return (
    <AppCtx.Provider value={ctx}>
      <HashRouter>
        {!ready ? (
          <Splash />
        ) : !session || !user ? (
          <AuthScreen />
        ) : !ws || !role ? (
          <Onboarding />
        ) : (
          <AppShell>
            <Suspense fallback={<ModuleSkeleton />}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/sales" element={<Sales />} />
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/notes" element={<Notes />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/audit" element={<AuditPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </AppShell>
        )}
      </HashRouter>
    </AppCtx.Provider>
  );
}
