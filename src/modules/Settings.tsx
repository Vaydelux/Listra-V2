import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2, Languages, Palette, Users, Mail, Database, AlertTriangle, Download,
  Trash2, ShieldCheck, KeyRound, UserPlus, Check, History, Boxes, Receipt, Wallet, StickyNote,
} from "lucide-react";
import { useApp, useCurrency, toast, useThemeStore } from "../store";
import {
  updateBusinessProfile, updateWorkspaceSettings, updateSmtp, testSmtp, listMembers,
  updateMemberRole, addMember, removeMember, listAudit, actorsIn, buildProductsCsv,
  buildSalesCsv, buildExpensesCsv, purgeDemoData, resetWorkspace, demoRecordCount, demoCounts,
  listProducts, listSales, listExpenses, listNotes,
  exportWorkspaceBackup, importWorkspaceBackup, selfTest,
} from "../lib/data";
import { isAppError } from "../lib/types";
import type { AppError, Role, AuditEntry } from "../lib/types";
import type { SelfTestResult } from "../lib/data";
import { CURRENCIES, TIMEZONES, AUDIT_ACTIONS } from "../lib/types";
import { fmtDate, downloadCsv, uid } from "../lib/format";
import { THEMES, applyTheme } from "../lib/theme";
import { Button, Input, Field, Select, Switch, Badge, ConfirmDialog, Pagination, EmptyState, PageHeader, Modal, cx } from "../components/ui";
import { ShredderOverlay } from "../components/Shredder";
import type { ShredGroup } from "../components/Shredder";

const SECTIONS = [
  { id: "business", label: "Business profile", icon: Building2, cap: null },
  { id: "localization", label: "Localization & currency", icon: Languages, cap: null },
  { id: "appearance", label: "Appearance", icon: Palette, cap: null },
  { id: "team", label: "Team & roles", icon: Users, cap: null },
  { id: "smtp", label: "SMTP & email", icon: Mail, cap: "smtp.manage" },
  { id: "data", label: "Data management", icon: Database, cap: null },
  { id: "danger", label: "Danger zone", icon: AlertTriangle, cap: "workspace.reset" },
] as const;

export default function Settings() {
  const { ws, tick, can } = useApp();
  const [params, setParams] = useSearchParams();
  const section = params.get("section") ?? "business";

  if (!ws) return null;
  const visible = SECTIONS.filter((s) => !s.cap || can(s.cap as "smtp.manage"));

  return (
    <div className="fade-up mx-auto max-w-[1100px]">
      <PageHeader title="Settings & administration" sub="Workspace configuration — privileged sections respect role capabilities" />
      <div className="flex flex-col gap-5 md:flex-row">
        <nav className="flex shrink-0 gap-1.5 overflow-x-auto md:w-[220px] md:flex-col" aria-label="Settings sections">
          {visible.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button key={s.id} onClick={() => setParams({ section: s.id }, { replace: true })} aria-pressed={active}
                className={cx("flex shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold transition-colors",
                  active ? "text-[var(--accent-soft-fg)]" : "text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-[var(--text)]")}
                style={active ? { background: "var(--accent-soft-bg)" } : undefined}>
                <Icon size={15} /> {s.label}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1 space-y-4">
          {section === "business" && <BusinessCard key={`b${tick}`} />}
          {section === "localization" && <LocalizationCard key={`l${tick}`} />}
          {section === "appearance" && <AppearanceCard />}
          {section === "team" && <TeamCard key={`t${tick}`} />}
          {section === "smtp" && <SmtpCard key={`s${tick}`} />}
          {section === "data" && <DataCard key={`d${tick}`} />}
          {section === "danger" && <DangerCard key={`x${tick}`} />}
        </div>
      </div>
    </div>
  );
}

function ErrBanner({ err }: { err: AppError | null }) {
  if (!err) return null;
  return <div className="rounded-[10px] border px-3.5 py-2.5 text-[13px] font-medium" style={{ borderColor: "color-mix(in srgb, var(--negative) 40%, transparent)", background: "color-mix(in srgb, var(--negative) 10%, transparent)", color: "var(--negative)" }} role="alert">{err.message}</div>;
}

/* ---------------- business profile ---------------- */

function BusinessCard() {
  const { ws, can } = useApp();
  const editable = can("settings.manage");
  const [f, setF] = useState({ ...ws!.business });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AppError | null>(null);

  const save = () => {
    setBusy(true); setErr(null);
    try { updateBusinessProfile(f); toast("Business profile saved"); }
    catch (e) { setErr(isAppError(e) ? e : { code: "UNEXPECTED", message: "Save failed" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="card-flat space-y-4 p-5">
      <div>
        <h2 className="font-display text-[16px] font-bold">Business identity</h2>
        <p className="text-[12.5px] text-[var(--muted)]">Shown on receipts, reports and emailed summaries.</p>
      </div>
      <ErrBanner err={err} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name"><Input value={f.name} disabled={!editable} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Contact email"><Input value={f.email} disabled={!editable} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} disabled={!editable} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Tax / registration ID"><Input value={f.taxId} disabled={!editable} onChange={(e) => setF({ ...f, taxId: e.target.value })} className="mono" /></Field>
      </div>
      <Field label="Address"><Input value={f.address} disabled={!editable} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <Field label="Receipt footer" hint="Printed at the bottom of every receipt."><Input value={f.receiptFooter} disabled={!editable} onChange={(e) => setF({ ...f, receiptFooter: e.target.value })} /></Field>
      {editable
        ? <div className="flex justify-end"><Button onClick={save} loading={busy}>Save changes</Button></div>
        : <p className="rounded-[10px] bg-[var(--surface2)] px-3.5 py-2.5 text-[12.5px] text-[var(--muted)]"><ShieldCheck size={13} className="mr-1.5 inline" /> Read-only for your role — an administrator manages business settings.</p>}
    </div>
  );
}

/* ---------------- localization ---------------- */

function LocalizationCard() {
  const { ws, can } = useApp();
  const editable = can("settings.manage");
  const [f, setF] = useState({ currency: ws!.currency, timezone: ws!.timezone, locale: ws!.locale });
  const [busy, setBusy] = useState(false);

  const save = () => {
    setBusy(true);
    try { updateWorkspaceSettings(f); toast("Localization saved"); }
    catch (e) { toast(isAppError(e) ? e.message : "Save failed", "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="card-flat space-y-4 p-5">
      <div>
        <h2 className="font-display text-[16px] font-bold">Localization & currency</h2>
        <p className="text-[12.5px] text-[var(--muted)]">Currency is stored as an ISO 4217 code and formatted with Intl.NumberFormat.</p>
      </div>
      <div className="rounded-[10px] border px-3.5 py-2.5 text-[12.5px] leading-relaxed" style={{ borderColor: "color-mix(in srgb, var(--warn) 40%, transparent)", background: "color-mix(in srgb, var(--warn) 9%, transparent)" }}>
        <strong className="text-[var(--warn)]">No silent conversion:</strong> <span className="text-[var(--muted)]">changing the presentation currency re-labels amounts only. Historical values are never exchange-rate converted without an explicit workflow.</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Currency">
          <Select value={f.currency} disabled={!editable} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Business timezone">
          <Select value={f.timezone} disabled={!editable} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
            {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Locale">
          <Select value={f.locale} disabled={!editable} onChange={(e) => setF({ ...f, locale: e.target.value })}>
            {["en-PH", "en-US", "en-GB", "en-SG", "ja-JP", "de-DE", "fr-FR", "es-ES"].map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </Field>
      </div>
      <p className="text-[12px] text-[var(--faint)]">Report day boundaries, “Today / This Week / This Month” presets and receipt timestamps all follow the workspace timezone.</p>
      {editable && <div className="flex justify-end"><Button onClick={save} loading={busy}>Save changes</Button></div>}
    </div>
  );
}

/* ---------------- appearance ---------------- */

function AppearanceCard() {
  const { themeId, setTheme, reduceMotion, setReduceMotion } = useThemeStore();
  return (
    <div className="card-flat space-y-4 p-5">
      <div>
        <h2 className="font-display text-[16px] font-bold">Appearance — 19 themes</h2>
        <p className="text-[12.5px] text-[var(--muted)]">Every preset derives accessible foregrounds from WCAG relative luminance at runtime.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {THEMES.map((t) => (
          <button key={t.id} onClick={() => { setTheme(t.id); applyTheme(t.id); }} aria-pressed={themeId === t.id}
            className={cx("overflow-hidden rounded-[10px] border text-left transition-all", themeId === t.id ? "border-[var(--accent)] shadow-lg" : "border-[var(--border)] hover:border-[var(--border-strong)]")}>
            <div className="flex h-[52px] items-end gap-1 p-2" style={{ background: t.v.bg }}>
              <div className="h-8 flex-1 rounded-md border p-1.5" style={{ background: t.v.surface, borderColor: t.v.border }}>
                <div className="h-1 w-3/4 rounded" style={{ background: t.v.accent }} />
                <div className="mt-1 h-1 w-1/2 rounded" style={{ background: t.v.border }} />
              </div>
              <span className="mb-0.5 h-5 w-5 rounded-full" style={{ background: t.v.accent }} />
            </div>
            <div className="flex items-center justify-between px-2.5 py-1.5" style={{ background: "var(--surface)" }}>
              <span className="truncate text-[11.5px] font-bold">{t.name}</span>
              <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--faint)]">
                {t.dark ? "dark" : "light"}{themeId === t.id && <Check size={11} className="text-[var(--positive)]" />}
              </span>
            </div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[var(--border)] pt-4">
        <Button variant="outline" size="sm" onClick={() => { setTheme("system"); applyTheme("system"); }}>Follow system preference</Button>
        <label className="flex items-center gap-2.5 text-[13px] font-medium text-[var(--muted)]">
          <Switch checked={reduceMotion} onChange={setReduceMotion} label="Reduce motion" /> Reduce motion
        </label>
      </div>
    </div>
  );
}

/* ---------------- team ---------------- */

function TeamCard() {
  const { ws, tick, can, user } = useApp();
  const editable = can("members.manage");
  const members = useMemo(() => (ws ? listMembers(ws.id) : []), [ws?.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [invite, setInvite] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [inv, setInv] = useState({ name: "", email: "", password: "", role: "STAFF" as Role });
  const [invErr, setInvErr] = useState<AppError | null>(null);

  const changeRole = (userId: string, role: "ADMIN" | "STAFF") => {
    try { updateMemberRole(userId, role); toast("Role updated"); }
    catch (e) { toast(isAppError(e) ? e.message : "Failed", "error"); }
  };

  const sendInvite = () => {
    setInvErr(null);
    if (inv.password.length < 8) { setInvErr({ code: "VALIDATION", message: "Temporary password needs at least 8 characters." }); return; }
    try {
      void addMember(inv.name, inv.email, inv.password, inv.role === "OWNER" ? "STAFF" : inv.role);
      toast(`Invited ${inv.email} — share the temporary password securely`);
      setInvite(false); setInv({ name: "", email: "", password: "", role: "STAFF" });
    } catch (e) { setInvErr(isAppError(e) ? e : { code: "UNEXPECTED", message: "Invite failed" }); }
  };

  return (
    <div className="card-flat space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-[16px] font-bold">Team & roles</h2>
          <p className="text-[12.5px] text-[var(--muted)]">ADMIN manages the workspace; STAFF runs daily operations. Capability checks run on every action.</p>
        </div>
        {editable && <Button size="sm" onClick={() => { setInvite(true); setInv({ ...inv, password: uid().slice(0, 10) + "A1" }); }}><UserPlus size={14} /> Add member</Button>}
      </div>
      <div className="space-y-2">
        {members.map(({ member, profile }) => {
          const initials = (profile?.name ?? "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
          const isSelf = profile?.id === user?.id;
          return (
            <div key={member.userId} className="inset-panel flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: "var(--accent-soft-bg)", color: "var(--accent-soft-fg)" }}>{initials}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-bold">{profile?.name ?? "Unknown"}{isSelf && <span className="ml-1.5 text-[11px] font-medium text-[var(--faint)]">(you)</span>}</p>
                <p className="truncate text-[11.5px] text-[var(--faint)]">{profile?.email} · joined {fmtDate(member.joinedAt, ws!.timezone)}</p>
              </div>
              <Badge tone={member.role === "STAFF" ? "info" : "accent"}>{member.role}</Badge>
              {editable && member.role !== "OWNER" && (
                <>
                  <Select className="h-8! w-[110px] text-[12px]" value={member.role} onChange={(e) => changeRole(member.userId, e.target.value as "ADMIN" | "STAFF")} aria-label={`Role for ${profile?.name}`}>
                    <option value="ADMIN">ADMIN</option><option value="STAFF">STAFF</option>
                  </Select>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${profile?.name}`} onClick={() => setRemoving({ id: member.userId, name: profile?.name ?? "member" })}><Trash2 size={14} /></Button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-[var(--faint)]"><ShieldCheck size={12} className="mr-1 inline" /> The last privileged administrator and the owner cannot be demoted or removed — the engine rejects it even if the UI allowed it.</p>

      <Modal open={invite} onClose={() => setInvite(false)} title="Add team member" sub="Creates an account with a temporary password — share it over a secure channel." width="max-w-md"
        footer={<><Button variant="ghost" onClick={() => setInvite(false)}>Cancel</Button><Button onClick={sendInvite}>Create member</Button></>}>
        <div className="space-y-3">
          <ErrBanner err={invErr} />
          <Field label="Full name"><Input value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
          <Field label="Temporary password" hint="Generated once — the member should reset it after first sign-in."><Input className="mono" value={inv.password} onChange={(e) => setInv({ ...inv, password: e.target.value })} /></Field>
          <Field label="Role">
            <Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as Role })}>
              <option value="STAFF">STAFF — operations</option><option value="ADMIN">ADMIN — full management</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.name}?`}
        body="They lose access to this workspace immediately and their active sessions are revoked. Their historical records remain attributed to them."
        confirmLabel="Remove member"
        onConfirm={() => {
          if (!removing) return;
          try { removeMember(removing.id); toast("Member removed"); setRemoving(null); }
          catch (e) { toast(isAppError(e) ? e.message : "Failed", "error"); }
        }} />
    </div>
  );
}

/* ---------------- smtp ---------------- */

function SmtpCard() {
  const { ws } = useApp();
  const s = ws!.smtp;
  const [f, setF] = useState({ host: s.host, port: String(s.port), secure: s.secure, user: s.user, password: "", fromName: s.fromName, fromEmail: s.fromEmail });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<AppError | null>(null);

  const save = () => {
    setErr(null); setBusy(true);
    try {
      updateSmtp({ ...f, port: Number(f.port) || 587 });
      toast("SMTP configuration saved (credentials stored server-side)");
    } catch (e) { setErr(isAppError(e) ? e : { code: "UNEXPECTED", message: "Save failed" }); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setErr(null); setTesting(true);
    try {
      const r = await testSmtp();
      toast(`SMTP handshake OK in ${r.latencyMs}ms (demo transport)`);
    } catch (e) { setErr(isAppError(e) ? e : { code: "SMTP_ERROR", message: "SMTP test failed." }); }
    finally { setTesting(false); }
  };

  return (
    <div className="card-flat space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-display text-[16px] font-bold"><KeyRound size={16} className="text-[var(--muted)]" /> SMTP & email</h2>
        <p className="text-[12.5px] text-[var(--muted)]">Used for executive report emails. Passwords are write-only: accepted on save, never returned to the browser.</p>
      </div>
      <ErrBanner err={err} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Host"><Input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.mailgun.org" className="mono" /></Field>
        <Field label="Port"><Input type="number" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} className="mono" /></Field>
        <Field label="TLS"><div className="flex h-[37px] items-center"><Switch checked={f.secure} onChange={(v) => setF({ ...f, secure: v })} label="Use TLS" /> <span className="ml-2 text-[12.5px] text-[var(--muted)]">{f.secure ? "STARTTLS/TLS on" : "off"}</span></div></Field>
        <Field label="Username"><Input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} className="mono" /></Field>
        <Field label="Password" hint={s.passSet ? "Stored — re-enter only to change." : "Required."}>
          <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={s.passSet ? "••••••••••" : "SMTP password"} autoComplete="new-password" />
        </Field>
        <Field label="From name"><Input value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} /></Field>
        <Field label="From address"><Input type="email" value={f.fromEmail} onChange={(e) => setF({ ...f, fromEmail: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={test} loading={testing} disabled={!s.configured && !f.host}>Test SMTP configuration</Button>
        <Button onClick={save} loading={busy} disabled={!f.password && !s.passSet}>Save configuration</Button>
      </div>
    </div>
  );
}

/* ---------------- production readiness board ---------------- */

const READINESS: { label: string; note: string; level: "real" | "sim" | "none" }[] = [
  { label: "Business logic & invariants", note: "Self-test verified below; encoded verbatim in the shipped SQL RPCs", level: "real" },
  { label: "UI, themes & PWA offline", note: "19-theme engine, honest offline mutation blocking, shell caching", level: "real" },
  { label: "Workspace isolation & authorization", note: "Capability-checked on every call; proven by the in-app self-test; unit suite + RLS drafted", level: "sim" },
  { label: "Authentication", note: "PBKDF2 hashing + lockout are real; sessions are local — no server to validate them", level: "sim" },
  { label: "Database", note: "localStorage, one browser. Postgres migrations shipped at production/supabase/migrations", level: "sim" },
  { label: "Audit trail", note: "Append-only in code; tamperable via devtools until the server owns it", level: "sim" },
  { label: "Email / SMTP", note: "Validated, audited, rate-limited transport — Nodemailer phase in PORTING.md", level: "sim" },
  { label: "Rate limiting", note: "Sliding windows in memory; Upstash Redis swap is documented", level: "sim" },
  { label: "Cross-device & team sync", note: "Cross-tab sync is live in this browser; cross-device needs Supabase Realtime (policy drafted)", level: "none" },
];

function ReadinessCard() {
  const dot: Record<string, string> = { real: "var(--positive)", sim: "var(--warn)", none: "var(--negative)" };
  const word: Record<string, string> = { real: "REAL", sim: "SIMULATED", none: "ABSENT" };
  return (
    <div className="card-flat p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[16px] font-bold">Production readiness — honest status</h2>
        <Badge tone="warn">demo build</Badge>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted)]">
        The gap to production is <strong className="text-[var(--text)]">infrastructure, not logic</strong>. Everything green below runs for real today;
        everything amber behaves correctly but lacks a server to make it trustworthy; red does not exist yet.
        Migrations + RPCs ship under <span className="mono text-[11.5px]">production/</span>.
      </p>
      <div className="mt-3.5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {READINESS.map((r) => (
          <div key={r.label} className="flex items-start gap-2.5">
            <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: dot[r.level], boxShadow: `0 0 0 3px color-mix(in srgb, ${dot[r.level]} 18%, transparent)` }} />
            <div className="min-w-0">
              <p className="text-[13px] font-bold leading-tight">
                {r.label}
                <span className="mono ml-2 text-[9.5px] font-bold tracking-wider" style={{ color: dot[r.level] }}>{word[r.level]}</span>
              </p>
              <p className="text-[11.5px] leading-snug text-[var(--faint)]">{r.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- data management ---------------- */

function DataCard() {
  const { ws, can, online } = useApp();
  const cur = useCurrency();
  const demoCount = useMemo(() => (ws ? demoRecordCount(ws.id) : 0), [ws?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [purge, setPurge] = useState(false);
  const [shred, setShred] = useState<{ title: string; sub: string; groups: ShredGroup[]; doneLabel: string; run: () => void } | null>(null);
  const [tests, setTests] = useState<SelfTestResult[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [pendingImport, setPendingImport] = useState<string | null>(null);

  const exp = (kind: "products" | "sales" | "expenses") => {
    try {
      const r = kind === "products" ? buildProductsCsv(ws!.id) : kind === "sales" ? buildSalesCsv(ws!.id) : buildExpensesCsv(ws!.id);
      downloadCsv(r.filename, r.csv);
      toast(`${kind} exported — ${r.rows} rows`);
    } catch (e) { toast(isAppError(e) ? e.message : "Export failed", "error"); }
  };

  const doExport = () => {
    try {
      const { json, filename } = exportWorkspaceBackup();
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Workspace backup downloaded");
    } catch (e) { toast(isAppError(e) ? e.message : "Backup failed", "error"); }
  };

  const runTests = () => {
    setTesting(true); setTests(null);
    setTimeout(() => {
      try { setTests(selfTest()); } catch (e) { toast(isAppError(e) ? e.message : "Self-test crashed", "error"); }
      finally { setTesting(false); }
    }, 60);
  };

  return (
    <div className="space-y-4">
      <ReadinessCard />

      <div className="card-flat space-y-3 p-5">
        <div>
          <h2 className="font-display text-[16px] font-bold">Data management</h2>
          <p className="text-[12.5px] text-[var(--muted)]">Full CSV exports — UTF-8 with BOM, formula-injection guarded, every export lands in the audit log.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => exp("products")} disabled={!can("reports.export")}><Download size={14} /> Products</Button>
          <Button variant="outline" size="sm" onClick={() => exp("sales")} disabled={!can("reports.export")}><Download size={14} /> Sales</Button>
          <Button variant="outline" size="sm" onClick={() => exp("expenses")} disabled={!can("reports.export")}><Download size={14} /> Expenses</Button>
        </div>
        <p className="text-[12px] text-[var(--faint)]">Presentation currency {cur.code} — exports carry raw numeric values, never converted history.</p>
      </div>

      <div className="card-flat space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-[16px] font-bold">Backups</h2>
            <p className="text-[12.5px] text-[var(--muted)]">This demo stores everything in this browser — a backup file is your only off-device copy. Export regularly; import replaces all current workspace data.</p>
          </div>
          <div className="flex gap-2">
            <label className="btn btn-outline btn-sm cursor-pointer">
              Import backup…
              <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                file.text().then((txt) => setPendingImport(txt));
                e.target.value = "";
              }} />
            </label>
            <Button variant="outline" size="sm" onClick={doExport} disabled={!can("settings.manage")}><Download size={14} /> Export backup</Button>
          </div>
        </div>
      </div>

      <div className="card-flat space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-display text-[16px] font-bold"><ShieldCheck size={16} className="text-[var(--positive)]" /> Integrity self-test</h2>
            <p className="text-[12.5px] text-[var(--muted)]">Runs the real engine — atomic sales, insufficient-stock rollback, void reversals, audit capture, workspace isolation, role enforcement — in a scratch workspace that is torn down afterwards.</p>
          </div>
          <Button size="sm" onClick={runTests} loading={testing} disabled={!online}>Run {tests ? "again" : "checks"}</Button>
        </div>
        {tests && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 pb-1">
              <Badge tone={tests.every((x) => x.pass) ? "ok" : "bad"}>
                {tests.filter((x) => x.pass).length}/{tests.length} passed
              </Badge>
              <span className="mono text-[11px] text-[var(--faint)]">{tests.reduce((x, y) => x + y.ms, 0).toFixed(0)} ms total</span>
            </div>
            {tests.map((x) => (
              <div key={x.name} className="inset-panel flex items-center gap-2.5 px-3 py-1.5">
                <Check size={13} style={{ color: x.pass ? "var(--positive)" : "var(--negative)" }} className="shrink-0" />
                <span className={cx("min-w-0 flex-1 truncate text-[12.5px]", x.pass ? "text-[var(--muted)]" : "font-semibold text-[var(--negative)]")}>{x.name}</span>
                {x.detail && <span className="mono max-w-[220px] truncate text-[10.5px] text-[var(--negative)]">{x.detail}</span>}
                <span className="mono shrink-0 text-[10.5px] text-[var(--faint)]">{x.ms}ms</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card-flat space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-[16px] font-bold">Purge sample data</h2>
            <p className="text-[12.5px] text-[var(--muted)]">Removes only records flagged as demo ({demoCount} currently). Real records, members and the audit trail are untouched.</p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setPurge(true)} disabled={!can("workspace.reset") || demoCount === 0}><Trash2 size={14} /> Purge {demoCount} demo records</Button>
        </div>
      </div>

      <ConfirmDialog open={purge} onClose={() => setPurge(false)} title="Purge sample data?" requireText="PURGE"
        body={<>This permanently deletes the {demoCount} seeded demo products, sales, expenses and notes in <strong>{ws?.name}</strong>. Audit history is preserved. This action is rate-limited and cannot be undone.</>}
        confirmLabel="Purge demo data"
        onConfirm={() => {
          if (!ws) return;
          const c = demoCounts(ws.id);
          setPurge(false);
          setShred({
            title: "Purging sample data",
            sub: `${ws.name} — audit trail preserved`,
            doneLabel: "Purged",
            groups: [
              { label: "products", n: c.products, icon: <Boxes size={13} />, tint: "var(--info)" },
              { label: "sales", n: c.sales, icon: <Receipt size={13} />, tint: "var(--accent)" },
              { label: "expenses", n: c.expenses, icon: <Wallet size={13} />, tint: "var(--warn)" },
              { label: "notes", n: c.notes, icon: <StickyNote size={13} />, tint: "var(--positive)" },
            ].filter((g) => g.n > 0),
            run: () => {
              try { const r = purgeDemoData(); toast(`Removed ${r.removed} demo records`); }
              catch (e) { toast(isAppError(e) ? e.message : "Purge failed", "error"); }
            },
          });
        }} />

      <ConfirmDialog open={!!pendingImport} onClose={() => setPendingImport(null)} title="Import backup?" requireText="IMPORT"
        body="Importing replaces ALL current products, sales, expenses and notes in this workspace with the backup contents. Type IMPORT to confirm."
        confirmLabel="Replace workspace data"
        onConfirm={() => {
          if (!pendingImport) return;
          try {
            const { counts } = importWorkspaceBackup(pendingImport);
            toast(`Imported ${counts.products} products · ${counts.sales} sales · ${counts.expenses} expenses · ${counts.notes} notes`);
            setPendingImport(null);
          } catch (e) { toast(isAppError(e) ? e.message : "Import failed", "error"); }
        }} />

      <ShredderOverlay
        open={!!shred} title={shred?.title ?? ""} sub={shred?.sub ?? ""}
        groups={shred?.groups ?? []} doneLabel={shred?.doneLabel ?? "Done"}
        onDone={() => { shred?.run(); setShred(null); }}
      />
    </div>
  );
}

/* ---------------- danger zone ---------------- */

function DangerCard() {
  const { ws, can } = useApp();
  const [resetOpen, setResetOpen] = useState(false);
  const [shred, setShred] = useState<{ title: string; sub: string; groups: ShredGroup[]; doneLabel: string; run: () => void } | null>(null);

  return (
    <div className="card-flat space-y-4 border-[color-mix(in srgb, var(--negative) 35%, transparent)] p-5">
      <div>
        <h2 className="flex items-center gap-2 font-display text-[16px] font-bold text-[var(--negative)]"><AlertTriangle size={16} /> Danger zone</h2>
        <p className="text-[12.5px] text-[var(--muted)]">Destructive, audited, rate-limited. In production, storage cleanup is compensating (documented) since it cannot share the database transaction.</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--border)] px-4 py-3">
        <div>
          <p className="text-[13.5px] font-bold">Reset workspace</p>
          <p className="text-[12px] text-[var(--muted)]">Clears products, stock history, sales, expenses and notes — keeps your account, membership, configuration and audit trail.</p>
        </div>
        <Button variant="danger" onClick={() => setResetOpen(true)} disabled={!can("workspace.reset")}>Reset workspace…</Button>
      </div>
      <ConfirmDialog open={resetOpen} onClose={() => setResetOpen(false)} title={`Reset ${ws?.name}?`} requireText={ws?.name}
        body={<>Every operational record in this workspace will be cleared inside a single transaction. Type the workspace name <strong className="mono">{ws?.name}</strong> to confirm. Default expense categories are restored; the audit log survives.</>}
        confirmLabel="Reset workspace"
        onConfirm={() => {
          if (!ws) return;
          const c = {
            products: listProducts(ws.id, { pageSize: 1 }).total,
            sales: listSales(ws.id, { pageSize: 1 }).total,
            expenses: listExpenses(ws.id, { pageSize: 1 }).total,
            notes: listNotes(ws.id, {}).length,
          };
          setResetOpen(false);
          setShred({
            title: "Resetting workspace",
            sub: `${ws.name} — configuration & audit trail preserved`,
            doneLabel: "Reset",
            groups: [
              { label: "products", n: c.products, icon: <Boxes size={13} />, tint: "var(--info)" },
              { label: "sales", n: c.sales, icon: <Receipt size={13} />, tint: "var(--accent)" },
              { label: "expenses", n: c.expenses, icon: <Wallet size={13} />, tint: "var(--warn)" },
              { label: "notes", n: c.notes, icon: <StickyNote size={13} />, tint: "var(--positive)" },
            ].filter((g) => g.n > 0),
            run: () => {
              try { resetWorkspace(ws.name); toast("Workspace reset — operational data cleared"); }
              catch (e) { toast(isAppError(e) ? e.message : "Reset failed", "error"); }
            },
          });
        }} />

      <ShredderOverlay
        open={!!shred} title={shred?.title ?? ""} sub={shred?.sub ?? ""}
        groups={shred?.groups ?? []} doneLabel={shred?.doneLabel ?? "Done"}
        onDone={() => { shred?.run(); setShred(null); }}
      />
    </div>
  );
}

/* ---------------- audit log (route /audit) ---------------- */

export function AuditLog() {
  const { ws, tick, can } = useApp();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const data = useMemo(() => {
    if (!ws) return null;
    const fromMs = from ? new Date(from + "T00:00:00Z").getTime() : undefined;
    const toMs = to ? new Date(to + "T00:00:00Z").getTime() + 86_400_000 : undefined;
    return {
      paged: listAudit(ws.id, { q: debouncedQ, action: action || undefined, actorId: actor || undefined, entityType: entity || undefined, fromMs, toMs, page, pageSize: 14 }),
      actors: actorsIn(ws.id),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, tick, debouncedQ, action, actor, entity, from, to, page]);

  if (!ws || !data) return null;

  if (!can("audit.view")) {
    return (
      <div className="fade-up mx-auto max-w-[900px]">
        <PageHeader title="Audit log" />
        <EmptyState icon={<History size={22} />} title="Restricted to administrators" body="The audit trail contains sensitive operational history. Ask an ADMIN if you need details about a specific event." />
      </div>
    );
  }

  return (
    <div className="fade-up mx-auto max-w-[1100px]">
      <PageHeader title="Audit log" sub="Append-only · ordinary roles cannot modify or delete entries" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-[220px]"><Input placeholder="Search action, actor, meta…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" /></div>
        <Select className="w-[190px]" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action filter">
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Select className="w-[150px]" value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }} aria-label="Actor filter">
          <option value="">All actors</option>
          {data.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select className="w-[150px]" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Entity filter">
          <option value="">All entities</option>
          {["product", "sale", "expense", "note", "member", "workspace", "smtp", "category", "report", "auth"].map((x) => <option key={x} value={x}>{x}</option>)}
        </Select>
        <Input type="date" className="w-[135px]" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
        <Input type="date" className="w-[135px]" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" />
      </div>

      {data.paged.total === 0 ? (
        <EmptyState icon={<History size={22} />} title="No matching events" body="Adjust the filters or clear the search." />
      ) : (
        <div className="card-flat overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
              <tbody>
                {data.paged.rows.map((a: AuditEntry) => (
                  <tr key={a.id}>
                    <td className="mono whitespace-nowrap text-[11.5px] text-[var(--muted)]">{fmtDate(a.createdAt, ws.timezone, true)}</td>
                    <td className="whitespace-nowrap text-[12.5px] font-semibold">{a.actorName}</td>
                    <td><Badge tone={a.action.includes("void") || a.action.includes("reset") || a.action.includes("purge") || a.action.includes("removed") ? "bad" : a.action.includes("created") || a.action.includes("recorded") ? "ok" : "neutral"}>{a.action}</Badge></td>
                    <td className="text-[12px] text-[var(--muted)]">{a.entityType}{a.entityId ? <span className="mono text-[10.5px]"> ·{a.entityId.slice(0, 6)}</span> : null}</td>
                    <td className="max-w-[340px]">
                      {Object.keys(a.meta).length > 0 ? (
                        <details className="group">
                          <summary className="cursor-pointer select-none text-[12px] font-semibold text-[var(--accent-soft-fg)]">metadata</summary>
                          <pre className="mono mt-1.5 max-h-[160px] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--field)] p-2.5 text-[10.5px] leading-relaxed text-[var(--muted)]">{JSON.stringify(a.meta, null, 2)}</pre>
                        </details>
                      ) : <span className="text-[12px] text-[var(--faint)]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 pb-3">
            <Pagination page={data.paged.page} pages={data.paged.pages} total={data.paged.total} noun="events" onPage={setPage} />
          </div>
        </div>
      )}
    </div>
  );
}
