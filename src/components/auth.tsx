import { useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, ArrowRight, ArrowLeft, MailCheck, Store, AlertTriangle, ShieldCheck, BarChart3, Boxes } from "lucide-react";
import { toast, useThemeStore } from "../store";
import { signup, login, verifyEmail, requestPasswordReset, resetPassword, createWorkspace } from "../lib/data";
import { isAppError } from "../lib/types";
import type { AppError } from "../lib/types";
import { CURRENCIES, TIMEZONES, OnboardingSchema } from "../lib/types";
import { Button, Input, Field, Select, Switch, cx } from "./ui";
import { ListraMark } from "./shell";

type Mode = "login" | "signup" | "verify" | "forgot" | "reset";

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>("login");
  const [f, setF] = useState({ name: "", email: "", password: "", code: "", newPassword: "" });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<AppError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void> | void) => {
    setErr(null); setBusy(key);
    try { await fn(); }
    catch (e) { setErr(isAppError(e) ? e : { code: "UNEXPECTED", message: "Something went wrong." }); }
    finally { setBusy(null); }
  };

  const doLogin = () => run("login", async () => { await login(f.email, f.password); toast("Welcome back"); });
  const doSignup = () => run("signup", async () => {
    const { verifyCode } = await signup(f.name, f.email, f.password);
    setIssuedCode(verifyCode); setMode("verify");
    toast("Account created — verify your email", "info");
  });
  const doVerify = () => run("verify", () => { verifyEmail(f.email, f.code); toast("Email verified — set up your workspace"); });
  const doForgot = () => run("forgot", () => { const { resetCode } = requestPasswordReset(f.email); setIssuedCode(resetCode); setMode("reset"); toast("Reset code issued", "info"); });
  const doReset = () => run("reset", async () => { await resetPassword(f.email, f.code, f.newPassword); toast("Password reset — sign in with your new password"); setMode("login"); });

  const fill = (email: string) => { setF({ ...f, email, password: "demo1234" }); setErr(null); };

  return (
    <div className="ambient flex min-h-screen items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 220, damping: 26 }}
        className="w-full max-w-[880px]">
        <div className="grid overflow-hidden rounded-[20px] border border-[var(--border)] shadow-2xl lg:grid-cols-[1.05fr_1fr]" style={{ background: "var(--surface)" }}>
          {/* brand panel */}
          <div className="relative hidden flex-col justify-between overflow-hidden p-8 lg:flex" style={{ background: "var(--bg)" }}>
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)", filter: "blur(40px)" }} />
            <div>
              <div className="flex items-center gap-3">
                <ListraMark size={40} />
                <div>
                  <p className="font-display text-[22px] font-bold leading-none tracking-tight">Listra</p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--faint)]">Business suite</p>
                </div>
              </div>
              <h1 className="mt-10 font-display text-[32px] font-bold leading-[1.08] tracking-tight">
                Every sale, sack of stock and peso — <span style={{ color: "var(--accent-soft-fg)" }}>accounted for.</span>
              </h1>
              <p className="mt-4 max-w-[380px] text-[13.5px] leading-relaxed text-[var(--muted)]">
                Atomic multi-item sales that can't oversell, immutable cost snapshots so yesterday's profit never restates, and a 19-theme workspace your team will actually enjoy.
              </p>
            </div>
            <div className="space-y-3">
              {[
                { icon: Boxes, title: "Stock that reconciles", body: "Every unit in or out writes a movement — RESTOCK, SALE, REVERSAL." },
                { icon: BarChart3, title: "Profit you can defend", body: "Revenue − COGS snapshots = gross. Subtract expenses, get net." },
                { icon: ShieldCheck, title: "Roles & audit trail", body: "OWNER / ADMIN / STAFF capabilities, append-only history." },
              ].map((x, i) => (
                <motion.div key={x.title} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.09 }}
                  className="flex items-start gap-3 rounded-[12px] border border-[var(--border)] p-3.5" style={{ background: "color-mix(in srgb, var(--surface) 65%, transparent)" }}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]" style={{ background: "var(--accent-soft-bg)", color: "var(--accent-soft-fg)" }}>
                    <x.icon size={15} />
                  </span>
                  <div>
                    <p className="text-[13px] font-bold">{x.title}</p>
                    <p className="text-[12px] leading-snug text-[var(--muted)]">{x.body}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* form panel */}
          <div className="p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <ListraMark size={34} />
              <p className="font-display text-[19px] font-bold">Listra</p>
            </div>

            {err && (
              <div className="mb-4 rounded-[10px] border px-3.5 py-2.5 text-[12.5px] font-medium" role="alert"
                style={{ borderColor: "color-mix(in srgb, var(--negative) 40%, transparent)", background: "color-mix(in srgb, var(--negative) 10%, transparent)", color: "var(--negative)" }}>
                {err.message}
                {err.fields?.code?.[0] && mode === "verify" && <span className="mono ml-1 font-bold">({err.fields.code[0]})</span>}
              </div>
            )}

            {mode === "login" && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-display text-[21px] font-bold">Sign in</h2>
                  <p className="mt-1 text-[12.5px] text-[var(--muted)]">Open your workspace ledger.</p>
                </div>
                <Field label="Email"><Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@business.com" /></Field>
                <Field label="Password">
                  <div className="relative">
                    <Input type={showPw ? "text" : "password"} autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="••••••••"
                      onKeyDown={(e) => e.key === "Enter" && doLogin()} />
                    <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] hover:text-[var(--text)]">
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </Field>
                <Button className="w-full" size="lg" loading={busy === "login"} onClick={doLogin}>Sign in <ArrowRight size={15} /></Button>
                <div className="flex items-center justify-between text-[12px]">
                  <button className="font-semibold text-[var(--accent-soft-fg)] hover:underline" onClick={() => { setErr(null); setMode("forgot"); }}>Forgot password?</button>
                  <button className="font-semibold text-[var(--accent-soft-fg)] hover:underline" onClick={() => { setErr(null); setMode("signup"); }}>Create account</button>
                </div>
                <div className="rounded-[12px] border border-dashed border-[var(--border-strong)] p-3.5">
                  <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--faint)]">Demo workspace — one tap</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={() => fill("owner@listra.app")}>Owner · ADMIN</Button>
                    <Button variant="outline" size="sm" onClick={() => fill("staff@listra.app")}>Staff · STAFF</Button>
                  </div>
                  <p className="mono mt-2 text-center text-[10.5px] text-[var(--faint)]">password: demo1234</p>
                </div>
                <p className="mt-2.5 flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-[10.5px] font-medium leading-snug"
                  style={{ background: "color-mix(in srgb, var(--warn) 10%, transparent)", color: "var(--warn)" }}>
                  <AlertTriangle size={12} className="mt-[1px] shrink-0" />
                  Demo build — everything runs in this browser (no server, no shared data). Don't run real money on it.
                </p>
              </div>
            )}

            {mode === "signup" && (
              <div className="space-y-4">
                <button className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setMode("login")}>
                  <ArrowLeft size={13} /> Back to sign in
                </button>
                <div>
                  <h2 className="font-display text-[21px] font-bold">Create your account</h2>
                  <p className="mt-1 text-[12.5px] text-[var(--muted)]">PBKDF2-hashed credentials, email verification, then workspace onboarding.</p>
                </div>
                <Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Alex Mercado" /></Field>
                <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@business.com" /></Field>
                <Field label="Password" hint="Minimum 8 characters"><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
                <Button className="w-full" size="lg" loading={busy === "signup"} onClick={doSignup}>Continue <ArrowRight size={15} /></Button>
              </div>
            )}

            {(mode === "verify" || mode === "reset") && (
              <div className="space-y-4">
                <button className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setMode(mode === "verify" ? "signup" : "login")}>
                  <ArrowLeft size={13} /> Back
                </button>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "var(--accent-soft-bg)", color: "var(--accent-soft-fg)" }}>
                    <MailCheck size={18} />
                  </span>
                  <div>
                    <h2 className="font-display text-[21px] font-bold">{mode === "verify" ? "Verify your email" : "Reset password"}</h2>
                    <p className="text-[12.5px] text-[var(--muted)]">6-digit code sent to {f.email}</p>
                  </div>
                </div>
                {issuedCode && (
                  <p className="rounded-[10px] border border-dashed border-[var(--border-strong)] px-3 py-2 text-[11.5px] text-[var(--muted)]">
                    Demo transport — your code is <span className="mono text-[14px] font-bold text-[var(--accent-soft-fg)]">{issuedCode}</span> (expires in 15 min)
                  </p>
                )}
                <Field label={mode === "verify" ? "Verification code" : "Reset code"}>
                  <Input className="mono text-center text-[18px] tracking-[0.4em]" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} />
                </Field>
                {mode === "reset" && (
                  <Field label="New password" hint="Minimum 8 characters — all sessions are revoked"><Input type="password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
                )}
                <Button className="w-full" size="lg" loading={busy === mode} onClick={mode === "verify" ? doVerify : doReset}>
                  {mode === "verify" ? "Verify & continue" : "Reset password"} <ArrowRight size={15} />
                </Button>
              </div>
            )}

            {mode === "forgot" && (
              <div className="space-y-4">
                <button className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setMode("login")}>
                  <ArrowLeft size={13} /> Back to sign in
                </button>
                <div>
                  <h2 className="font-display text-[21px] font-bold">Forgot password</h2>
                  <p className="mt-1 text-[12.5px] text-[var(--muted)]">We'll issue a reset code — rate limited to prevent abuse.</p>
                </div>
                <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@business.com" /></Field>
                <Button className="w-full" size="lg" loading={busy === "forgot"} onClick={doForgot}>Send reset code <ArrowRight size={15} /></Button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ---------------- onboarding ---------------- */

export function Onboarding() {
  const [f, setF] = useState({ businessName: "", currency: "PHP", timezone: "Asia/Manila", locale: "en-PH", loadSampleData: true });
  const [err, setErr] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setErr(null); setBusy(true);
    try {
      OnboardingSchema.parse(f);
      await createWorkspace(f);
      toast("Workspace created — welcome to Listra");
    } catch (e) {
      setErr(isAppError(e) ? e : { code: "UNEXPECTED", message: "Workspace creation failed — nothing was partially written." });
    } finally { setBusy(false); }
  };

  return (
    <div className="ambient flex min-h-screen items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[520px]">
        <div className="rounded-[20px] border border-[var(--border)] p-6 shadow-2xl sm:p-8" style={{ background: "var(--surface)" }}>
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-[12px]" style={{ background: "var(--accent-soft-bg)", color: "var(--accent-soft-fg)" }}>
              <Store size={18} />
            </span>
            <div>
              <h1 className="font-display text-[20px] font-bold leading-tight">Set up your business</h1>
              <p className="text-[12.5px] text-[var(--muted)]">Creates your workspace, OWNER membership and default expense categories atomically.</p>
            </div>
          </div>
          {err && (
            <div className="mb-4 rounded-[10px] border px-3.5 py-2.5 text-[12.5px] font-medium" role="alert"
              style={{ borderColor: "color-mix(in srgb, var(--negative) 40%, transparent)", background: "color-mix(in srgb, var(--negative) 10%, transparent)", color: "var(--negative)" }}>
              {err.message}
            </div>
          )}
          <div className="space-y-4">
            <Field label="Business name"><Input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} placeholder="Mercado Daily Goods" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency" hint="ISO code — never converts historical values">
                <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </Select>
              </Field>
              <Field label="Business timezone" hint="Report day boundaries follow this">
                <Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                  {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-[12px] border border-[var(--border)] px-4 py-3">
              <div>
                <p className="text-[13px] font-bold">Load 30 days of sample data</p>
                <p className="text-[11.5px] text-[var(--muted)]">Seeded through the real sale engine — stock reconciles exactly.</p>
              </div>
              <Switch checked={f.loadSampleData} onChange={(v) => setF({ ...f, loadSampleData: v })} label="Load sample data" />
            </div>
            <Button className="w-full" size="lg" loading={busy} onClick={create} disabled={f.businessName.trim().length < 2}>
              Create workspace <ArrowRight size={15} />
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
