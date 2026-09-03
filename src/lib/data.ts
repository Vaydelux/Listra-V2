/**
 * Listra ledger engine — the authoritative domain layer.
 *
 * Every mutation follows the same pipeline:
 *   authenticate → resolve membership → check capability → Zod-validate →
 *   transform (immutable snapshots, cent-rounded money) → commit atomically →
 *   append audit → emit.
 *
 * In production these bodies swap 1:1 for Supabase RPC calls
 * (see production/supabase/migrations/0002_functions.sql). The rules encoded
 * here — snapshots, movements, idempotency, lock ordering — are the product.
 */
import { z } from "zod";
import {
  ProductInputSchema, RestockInputSchema, AdjustStockInputSchema, CategoryInputSchema,
  SignupSchema, LoginSchema, OnboardingSchema, EmailReportInputSchema, isAppError,
} from "./types";
import type {
  Profile, Session, Workspace, Member, Role, Product, ProductCategory, StockMovement,
  Sale, SaleInput, SaleItemSnapshot, PaymentMethod, Expense, ExpenseCategory, Note,
  AuditEntry, AppError, Capability, StockMovementType,
} from "./types";
import { can as roleCan } from "./types";
import { round2, uid, presetRange, rangeToUtc, listDays, toCsv, relTime } from "./format";

export { isAppError };
export { can as roleCan } from "./types";

/* ---------------- storage & state ---------------- */

const DB_KEY = "listra.db.v3";
const SESSION_KEY = "listra.session.token";
const VERSION = 3;

interface DB {
  v: number;
  profiles: Profile[]; sessions: Session[];
  workspaces: Workspace[]; members: Member[];
  products: Product[]; productCategories: ProductCategory[]; movements: StockMovement[];
  sales: Sale[]; expenses: Expense[]; expenseCategories: ExpenseCategory[];
  notes: Note[]; audit: AuditEntry[];
  txnSeq: number;
}

const emptyDb = (): DB => ({
  v: VERSION, profiles: [], sessions: [], workspaces: [], members: [],
  products: [], productCategories: [], movements: [], sales: [], expenses: [],
  expenseCategories: [], notes: [], audit: [], txnSeq: 1000,
});

let db: DB = emptyDb();
let listeners: (() => void)[] = [];
let currentToken: string | null = null;
let seeding = false;

export function subscribe(fn: () => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

function emit(): void { listeners.forEach((l) => l()); }

function commit(): void {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* quota */ }
  emit();
}

/* Cross-tab realtime. `storage` events fire only in OTHER tabs, so open tabs
   converge on every write — the same invalidate-and-reread contract Supabase
   Realtime gives the production app. */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== DB_KEY && e.key !== SESSION_KEY && e.key !== null) return;
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const next = JSON.parse(raw) as DB;
        if (next.v >= db.v) Object.assign(db, next);
      }
      currentToken = localStorage.getItem(SESSION_KEY);
      emit();
    } catch { /* stay on current state */ }
  });
}

/* ---------------- errors & logging ---------------- */

export function appError(code: AppError["code"], message: string, fields?: AppError["fields"]): AppError {
  return { code, message, fields };
}

export function logEvent(severity: "info" | "warn" | "error", event: string, meta: Record<string, unknown> = {}): void {
  // Provider-neutral structured log; credential-free by construction.
  // eslint-disable-next-line no-console
  console.debug(`[listra] ${new Date().toISOString()} ${severity} ${event}`, meta);
}

/* ---------------- rate limiting (sliding window, in-memory) ---------------- */

const windows = new Map<string, number[]>();

function slidingLimit(name: string, key: string, max: number, windowMs: number): void {
  const k = `${name}:${key}`;
  const now = Date.now();
  const hits = (windows.get(k) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    throw appError("RATE_LIMITED", `Too many attempts. Try again in ${Math.ceil((windowMs - (now - hits[0])) / 1000)}s.`);
  }
  hits.push(now);
  windows.set(k, hits);
}

/* ---------------- crypto helpers ---------------- */

async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 120_000, hash: "SHA-256" }, key, 256,
  );
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const code = () => String(Math.floor(100000 + Math.random() * 900000));

/* ---------------- auth & session ---------------- */

function setToken(t: string | null): void {
  currentToken = t;
  if (t) localStorage.setItem(SESSION_KEY, t);
  else localStorage.removeItem(SESSION_KEY);
}

function createSession(userId: string, workspaceId: string | null): Session {
  const s: Session = {
    token: uid() + uid(), userId, workspaceId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
  db.sessions.push(s);
  return s;
}

export function getSession(): Session | null {
  if (!currentToken) return null;
  const s = db.sessions.find((x) => x.token === currentToken);
  if (!s) { setToken(null); return null; }
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    db.sessions = db.sessions.filter((x) => x.token !== s.token);
    setToken(null); commit();
    return null;
  }
  return s;
}

export function getCurrentUser(): Profile | null {
  const s = getSession();
  return s ? db.profiles.find((p) => p.id === s.userId) ?? null : null;
}

const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

export async function signup(name: string, email: string, password: string): Promise<{ verifyCode: string }> {
  slidingLimit("auth", "signup", 5, 15 * 60_000);
  const v = SignupSchema.parse({ name, email, password });
  const normalized = v.email.trim().toLowerCase();
  if (db.profiles.some((p) => p.email === normalized)) {
    throw appError("CONFLICT", "An account with this email already exists.");
  }
  const salt = uid();
  const profile: Profile = {
    id: uid(), email: normalized, name: v.name.trim(),
    passHash: await hashPassword(password, salt), salt,
    emailVerified: false, verifyCode: code(), verifyExpiresAt: Date.now() + 15 * 60_000,
    resetCode: null, resetExpiresAt: 0, createdAt: new Date().toISOString(),
  };
  db.profiles.push(profile);
  logEvent("info", "auth.signup", { userId: profile.id });
  commit();
  return { verifyCode: profile.verifyCode! };
}

export function verifyEmail(email: string, userCode: string): void {
  const p = db.profiles.find((x) => x.email === email.trim().toLowerCase());
  if (!p) throw appError("NOT_FOUND", "Account not found.");
  if (p.emailVerified) return;
  if (Date.now() > p.verifyExpiresAt) {
    p.verifyCode = code(); p.verifyExpiresAt = Date.now() + 15 * 60_000;
    commit();
    throw appError("VALIDATION", "Verification code expired — a new one was issued.", { code: ["Expired"] });
  }
  if (p.verifyCode !== userCode.trim()) {
    throw appError("VALIDATION", "Incorrect verification code.", { code: ["Incorrect code"] });
  }
  p.emailVerified = true;
  p.verifyCode = null;
  const m = db.members.find((x) => x.userId === p.id && x.status === "ACTIVE");
  const s = createSession(p.id, m?.workspaceId ?? null);
  setToken(s.token);
  commit();
}

export async function login(email: string, password: string): Promise<Profile> {
  slidingLimit("auth", "login", 12, 15 * 60_000);
  const v = LoginSchema.parse({ email, password });
  const normalized = v.email.trim().toLowerCase();
  const p = db.profiles.find((x) => x.email === normalized);

  const fail = loginFailures.get(normalized) ?? { count: 0, lockedUntil: 0 };
  if (fail.lockedUntil > Date.now()) {
    throw appError("RATE_LIMITED", `Account temporarily locked. Try again in ${Math.ceil((fail.lockedUntil - Date.now()) / 1000)}s.`);
  }
  if (!p || p.passHash !== (await hashPassword(password, p.salt))) {
    fail.count += 1;
    if (fail.count >= 5) { fail.lockedUntil = Date.now() + 60_000; fail.count = 0; }
    loginFailures.set(normalized, fail);
    throw appError("UNAUTHENTICATED", "Invalid email or password.");
  }
  loginFailures.delete(normalized);
  if (!p.emailVerified) {
    p.verifyCode = code(); p.verifyExpiresAt = Date.now() + 15 * 60_000;
    commit();
    throw appError("VALIDATION", "Email not verified — check your code.", { code: [p.verifyCode!] });
  }
  const m = db.members.find((x) => x.userId === p.id && x.status === "ACTIVE");
  const s = createSession(p.id, m?.workspaceId ?? null);
  setToken(s.token);
  logEvent("info", "auth.login", { userId: p.id });
  commit();
  return p;
}

export function logout(): void {
  const s = getSession();
  if (s) db.sessions = db.sessions.filter((x) => x.token !== s.token);
  setToken(null);
  commit();
}

export function requestPasswordReset(email: string): { resetCode: string } {
  slidingLimit("auth", "reset", 5, 15 * 60_000);
  const p = db.profiles.find((x) => x.email === email.trim().toLowerCase());
  if (!p) throw appError("NOT_FOUND", "No account with that email.");
  p.resetCode = code(); p.resetExpiresAt = Date.now() + 15 * 60_000;
  commit();
  return { resetCode: p.resetCode };
}

export async function resetPassword(email: string, resetCodeInput: string, newPassword: string): Promise<void> {
  const p = db.profiles.find((x) => x.email === email.trim().toLowerCase());
  if (!p || p.resetCode !== resetCodeInput.trim() || Date.now() > p.resetExpiresAt) {
    throw appError("VALIDATION", "Invalid or expired reset code.");
  }
  p.salt = uid();
  p.passHash = await hashPassword(newPassword, p.salt);
  p.resetCode = null; p.resetExpiresAt = 0;
  db.sessions = db.sessions.filter((s) => s.userId !== p.id); // revoke all sessions
  logEvent("info", "auth.password_reset", { userId: p.id });
  commit();
}

/* ---------------- actor resolution & authorization ---------------- */

function requireActor(): { userId: string; name: string; wsId: string; role: Role } {
  if (!seeding && typeof navigator !== "undefined" && !navigator.onLine) {
    throw appError("OFFLINE", "You're offline — mutations are disabled until you reconnect. Nothing was saved.");
  }
  const s = getSession();
  if (!s) throw appError("UNAUTHENTICATED", "Your session expired. Sign in again.");
  const p = db.profiles.find((x) => x.id === s.userId);
  if (!p) throw appError("UNAUTHENTICATED", "Account not found.");
  const m = db.members.find((x) => x.workspaceId === s.workspaceId && x.userId === s.userId && x.status === "ACTIVE");
  if (!s.workspaceId || !m) throw appError("FORBIDDEN", "No active workspace membership.");
  return { userId: s.userId, name: p.name, wsId: s.workspaceId, role: m.role };
}

function requireCap(actor: { role: Role; userId: string }, cap: Capability): void {
  if (!roleCan(actor.role, cap)) {
    throw appError("FORBIDDEN", `Your role (${actor.role}) doesn't include "${cap}". Ask an administrator.`);
  }
}

/* ---------------- audit (append-only) ---------------- */

function audit(actorId: string, actorName: string, wsId: string, action: string, entityType: string, entityId: string | null, meta: Record<string, unknown> = {}): void {
  db.audit.push({ id: uid(), workspaceId: wsId, actorId, actorName, action, entityType, entityId, meta, createdAt: new Date().toISOString() });
}

/* ---------------- workspace ---------------- */

export function getWorkspace(wsId: string): Workspace | null {
  return db.workspaces.find((w) => w.id === wsId) ?? null;
}

export function getRole(wsId: string, userId: string): Role | null {
  return db.members.find((m) => m.workspaceId === wsId && m.userId === userId && m.status === "ACTIVE")?.role ?? null;
}

export async function createWorkspace(input: unknown): Promise<Workspace> {
  const v = OnboardingSchema.parse(input);
  const s = getSession();
  if (!s) throw appError("UNAUTHENTICATED", "Sign in first.");
  const p = db.profiles.find((x) => x.id === s.userId)!;
  if (db.members.some((m) => m.userId === p.id && m.status === "ACTIVE")) {
    throw appError("CONFLICT", "You already have a workspace.");
  }
  const now = new Date().toISOString();
  const ws: Workspace = {
    id: uid(), name: v.businessName, currency: v.currency, timezone: v.timezone, locale: v.locale, createdAt: now,
    business: { name: v.businessName, email: p.email, phone: "", address: "", receiptFooter: "Thank you for your business!", taxId: "" },
    smtp: { host: "", port: 587, secure: true, user: "", passHash: null, passSet: false, fromName: v.businessName, fromEmail: p.email, configured: false },
  };
  db.workspaces.push(ws);
  db.members.push({ workspaceId: ws.id, userId: p.id, role: "OWNER", status: "ACTIVE", joinedAt: now });
  for (const name of ["Meals", "Travel", "Marketing", "Software", "Office"]) {
    db.expenseCategories.push({ id: uid(), workspaceId: ws.id, name, archived: false, isDefault: true, createdAt: now });
  }
  s.workspaceId = ws.id;
  audit(p.id, p.name, ws.id, "workspace.created", "workspace", ws.id, { name: ws.name, currency: ws.currency });
  if (v.loadSampleData) {
    seeding = true;
    try { seedSampleDataInto(ws, p); } finally { seeding = false; }
  }
  commit();
  return ws;
}

export function updateBusinessProfile(input: Partial<Workspace["business"]>): void {
  const a = requireActor();
  requireCap(a, "settings.manage");
  const ws = getWorkspace(a.wsId)!;
  const before = { ...ws.business };
  ws.business = { ...ws.business, ...input };
  audit(a.userId, a.name, a.wsId, "workspace.updated", "workspace", a.wsId, { section: "business", before, after: ws.business });
  commit();
}

export function updateWorkspaceSettings(input: { currency?: string; timezone?: string; locale?: string }): void {
  const a = requireActor();
  requireCap(a, "settings.manage");
  const ws = getWorkspace(a.wsId)!;
  const before = { currency: ws.currency, timezone: ws.timezone, locale: ws.locale };
  if (input.currency) ws.currency = input.currency;
  if (input.timezone) ws.timezone = input.timezone;
  if (input.locale) ws.locale = input.locale;
  audit(a.userId, a.name, a.wsId, "workspace.updated", "workspace", a.wsId, {
    section: "localization", before,
    after: { currency: ws.currency, timezone: ws.timezone, locale: ws.locale },
  });
  commit();
}

/* ---------------- members ---------------- */

export function listMembers(wsId: string): { member: Member; profile: Profile | null }[] {
  return db.members.filter((m) => m.workspaceId === wsId && m.status === "ACTIVE")
    .map((m) => ({ member: m, profile: db.profiles.find((p) => p.id === m.userId) ?? null }));
}

export function updateMemberRole(userId: string, role: "ADMIN" | "STAFF"): void {
  const a = requireActor();
  requireCap(a, "members.manage");
  const m = db.members.find((x) => x.workspaceId === a.wsId && x.userId === userId && x.status === "ACTIVE");
  if (!m) throw appError("NOT_FOUND", "Member not found.");
  if (m.role === "OWNER") throw appError("FORBIDDEN", "The owner's role cannot be changed.");
  const admins = db.members.filter((x) => x.workspaceId === a.wsId && x.status === "ACTIVE" && x.role !== "STAFF");
  if (m.role !== "STAFF" && role === "STAFF" && admins.length <= 1) {
    throw appError("CONFLICT", "A workspace needs at least one privileged administrator.");
  }
  const before = m.role;
  m.role = role;
  audit(a.userId, a.name, a.wsId, "member.role_changed", "member", userId, { before, after: role });
  commit();
}

export async function addMember(name: string, email: string, tempPassword: string, role: Role): Promise<void> {
  const a = requireActor();
  requireCap(a, "members.manage");
  slidingLimit("auth", "invite", 10, 60 * 60_000);
  const normalized = email.trim().toLowerCase();
  if (db.profiles.some((p) => p.email === normalized)) throw appError("CONFLICT", "Email already registered.");
  const salt = uid();
  const p: Profile = {
    id: uid(), email: normalized, name: name.trim(), passHash: await hashPassword(tempPassword, salt), salt,
    emailVerified: true, verifyCode: null, verifyExpiresAt: 0, resetCode: null, resetExpiresAt: 0,
    createdAt: new Date().toISOString(),
  };
  db.profiles.push(p);
  db.members.push({ workspaceId: a.wsId, userId: p.id, role: role === "OWNER" ? "ADMIN" : role, status: "ACTIVE", joinedAt: new Date().toISOString() });
  audit(a.userId, a.name, a.wsId, "member.added", "member", p.id, { email: normalized, role });
  commit();
}

export function removeMember(userId: string): void {
  const a = requireActor();
  requireCap(a, "members.manage");
  const m = db.members.find((x) => x.workspaceId === a.wsId && x.userId === userId && x.status === "ACTIVE");
  if (!m) throw appError("NOT_FOUND", "Member not found.");
  if (m.role === "OWNER") throw appError("FORBIDDEN", "The owner cannot be removed.");
  const admins = db.members.filter((x) => x.workspaceId === a.wsId && x.status === "ACTIVE" && x.role !== "STAFF");
  if (m.role !== "STAFF" && admins.length <= 1) throw appError("CONFLICT", "Cannot remove the last administrator.");
  m.status = "INACTIVE";
  db.sessions = db.sessions.filter((s) => s.userId !== userId);
  audit(a.userId, a.name, a.wsId, "member.removed", "member", userId, {});
  commit();
}

/* ---------------- inventory ---------------- */

export function createProduct(input: unknown): Product {
  const a = requireActor();
  requireCap(a, "inventory.create");
  const v = ProductInputSchema.parse(input);
  if (db.products.some((p) => p.workspaceId === a.wsId && p.sku.toLowerCase() === v.sku.toLowerCase() && !p.archived)) {
    throw appError("CONFLICT", `SKU "${v.sku}" already exists.`);
  }
  const now = new Date().toISOString();
  const p: Product = {
    id: uid(), workspaceId: a.wsId, name: v.name, sku: v.sku, categoryId: v.categoryId,
    description: v.description, costPrice: round2(v.costPrice), sellingPrice: round2(v.sellingPrice),
    stock: v.stock, reorderLevel: v.reorderLevel, unit: v.unit, barcode: v.barcode,
    archived: false, isDemo: false, createdAt: now, updatedAt: now,
  };
  db.products.push(p);
  if (v.stock > 0) {
    db.movements.push({
      id: uid(), workspaceId: a.wsId, productId: p.id, type: "RESTOCK", qty: v.stock,
      unitCost: p.costPrice, ref: "", saleId: null, note: "Opening stock",
      actorId: a.userId, actorName: a.name, createdAt: now,
    });
  }
  audit(a.userId, a.name, a.wsId, "product.created", "product", p.id, { name: p.name, sku: p.sku, cost: p.costPrice, price: p.sellingPrice, stock: p.stock });
  commit();
  return p;
}

export function updateProduct(id: string, input: unknown): Product {
  const a = requireActor();
  requireCap(a, "inventory.update");
  const v = ProductInputSchema.parse(input);
  const p = db.products.find((x) => x.id === id && x.workspaceId === a.wsId);
  if (!p) throw appError("NOT_FOUND", "Product not found.");
  const before = { name: p.name, sku: p.sku, costPrice: p.costPrice, sellingPrice: p.sellingPrice };
  Object.assign(p, {
    name: v.name, sku: v.sku, categoryId: v.categoryId, description: v.description,
    costPrice: round2(v.costPrice), sellingPrice: round2(v.sellingPrice),
    reorderLevel: v.reorderLevel, unit: v.unit, barcode: v.barcode, updatedAt: new Date().toISOString(),
  });
  audit(a.userId, a.name, a.wsId, "product.updated", "product", id, { before, after: { name: p.name, sku: p.sku, costPrice: p.costPrice, sellingPrice: p.sellingPrice } });
  commit();
  return p;
}

export function archiveProduct(id: string): void {
  const a = requireActor();
  requireCap(a, "inventory.update");
  const p = db.products.find((x) => x.id === id && x.workspaceId === a.wsId);
  if (!p) throw appError("NOT_FOUND", "Product not found.");
  p.archived = !p.archived;
  audit(a.userId, a.name, a.wsId, p.archived ? "product.archived" : "product.updated", "product", id, { archived: p.archived });
  commit();
}

export function restockProduct(input: unknown): void {
  const a = requireActor();
  requireCap(a, "stock.restock");
  const v = RestockInputSchema.parse(input);
  const p = db.products.find((x) => x.id === v.productId && x.workspaceId === a.wsId && !x.archived);
  if (!p) throw appError("NOT_FOUND", "Product not found.");
  p.stock += v.quantity;
  if (v.currentCost != null) p.costPrice = round2(v.currentCost);
  p.updatedAt = new Date().toISOString();
  db.movements.push({
    id: uid(), workspaceId: a.wsId, productId: p.id, type: "RESTOCK", qty: v.quantity,
    unitCost: v.currentCost != null ? round2(v.currentCost) : null, ref: v.reference ?? "",
    saleId: null, note: v.reference || "Restock", actorId: a.userId, actorName: a.name, createdAt: p.updatedAt,
  });
  audit(a.userId, a.name, a.wsId, "product.restocked", "product", p.id, { quantity: v.quantity, newStock: p.stock, cost: v.currentCost ?? null });
  commit();
}

export function adjustStock(input: unknown): void {
  const a = requireActor();
  requireCap(a, "inventory.adjust");
  const v = AdjustStockInputSchema.parse(input);
  const p = db.products.find((x) => x.id === v.productId && x.workspaceId === a.wsId && !x.archived);
  if (!p) throw appError("NOT_FOUND", "Product not found.");
  if (p.stock + v.delta < 0) throw appError("INSUFFICIENT_STOCK", `Adjustment would make stock negative (current ${p.stock}).`);
  p.stock += v.delta;
  p.updatedAt = new Date().toISOString();
  db.movements.push({
    id: uid(), workspaceId: a.wsId, productId: p.id, type: "ADJUSTMENT", qty: v.delta,
    unitCost: null, ref: v.reason, saleId: null, note: v.reason,
    actorId: a.userId, actorName: a.name, createdAt: p.updatedAt,
  });
  audit(a.userId, a.name, a.wsId, "stock.adjusted", "product", p.id, { delta: v.delta, newStock: p.stock, reason: v.reason });
  commit();
}

export function createProductCategory(name: string): ProductCategory {
  const a = requireActor();
  requireCap(a, "inventory.create");
  const v = CategoryInputSchema.parse({ name });
  if (db.productCategories.some((c) => c.workspaceId === a.wsId && c.name.toLowerCase() === v.name.toLowerCase() && !c.archived)) {
    throw appError("CONFLICT", "Category already exists.");
  }
  const c: ProductCategory = { id: uid(), workspaceId: a.wsId, name: v.name, archived: false, createdAt: new Date().toISOString() };
  db.productCategories.push(c);
  audit(a.userId, a.name, a.wsId, "category.created", "category", c.id, { name: v.name });
  commit();
  return c;
}

export function archiveProductCategory(id: string): void {
  const a = requireActor();
  requireCap(a, "inventory.update");
  const c = db.productCategories.find((x) => x.id === id && x.workspaceId === a.wsId);
  if (!c) throw appError("NOT_FOUND", "Category not found.");
  const used = db.products.filter((p) => p.workspaceId === a.wsId && p.categoryId === id && !p.archived).length;
  if (!c.archived && used > 0) {
    throw appError("CONFLICT", `${used} active product(s) use this category — reassign them first.`);
  }
  c.archived = !c.archived;
  audit(a.userId, a.name, a.wsId, "category.archived", "category", id, { archived: c.archived });
  commit();
}

export interface Paged<T> { rows: T[]; total: number; page: number; pages: number; }

function paginate<T>(rows: T[], page: number, pageSize: number): Paged<T> {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((p - 1) * pageSize, p * pageSize), total, page: p, pages };
}

export function listProducts(wsId: string, o: { q?: string; categoryId?: string; stock?: "all" | "low" | "out"; sort?: string; dir?: "asc" | "desc"; page?: number; pageSize?: number }): Paged<Product> {
  let rows = db.products.filter((p) => p.workspaceId === wsId);
  if (o.q) {
    const q = o.q.toLowerCase();
    rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q));
  }
  if (o.categoryId) rows = rows.filter((p) => p.categoryId === o.categoryId);
  if (o.stock === "low") rows = rows.filter((p) => !p.archived && p.stock > 0 && p.stock <= p.reorderLevel);
  if (o.stock === "out") rows = rows.filter((p) => !p.archived && p.stock === 0);
  const dir = o.dir === "asc" ? 1 : -1;
  const sorters: Record<string, (p: Product) => number | string> = {
    created: (p) => p.createdAt, name: (p) => p.name.toLowerCase(), stock: (p) => p.stock,
    price: (p) => p.sellingPrice, margin: (p) => (p.sellingPrice > 0 ? (p.sellingPrice - p.costPrice) / p.sellingPrice : 0),
  };
  const key = sorters[o.sort ?? "created"] ?? sorters.created;
  rows = [...rows].sort((x, y) => {
    const av = key(x); const bv = key(y);
    return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
  });
  // Archived sink to the bottom in default views.
  rows = [...rows.filter((p) => !p.archived), ...rows.filter((p) => p.archived)];
  return paginate(rows, o.page ?? 1, o.pageSize ?? 9);
}

export function productById(id: string): Product | null {
  return db.products.find((p) => p.id === id) ?? null;
}

export function listCategoriesWithCounts(wsId: string): (ProductCategory & { count: number })[] {
  return db.productCategories.filter((c) => c.workspaceId === wsId).map((c) => ({
    ...c, count: db.products.filter((p) => p.workspaceId === wsId && p.categoryId === c.id && !p.archived).length,
  }));
}

export function movementsFor(productId: string): StockMovement[] {
  return db.movements.filter((m) => m.productId === productId).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

/* ---------------- sales ---------------- */

export function recordSale(input: SaleInput, idempotencyKey?: string): Sale {
  const a = requireActor();
  requireCap(a, "sales.create");
  slidingLimit("sales", a.userId, 40, 60_000);

  if (input.lines.length === 0) throw appError("VALIDATION", "Add at least one item.");

  // Consolidate duplicate lines (same product + same price) before validation.
  const consolidated = new Map<string, { productId: string; qty: number; overridePrice: number | null; lineDiscount: number }>();
  for (const l of input.lines) {
    const key = `${l.productId}:${l.overridePrice ?? ""}`;
    const ex = consolidated.get(key);
    if (ex) { ex.qty += l.qty; ex.lineDiscount = round2(ex.lineDiscount + (l.lineDiscount || 0)); }
    else consolidated.set(key, { ...l });
  }
  const lines = [...consolidated.values()];

  const orderDiscount = round2(input.orderDiscount || 0);
  if (orderDiscount < 0) throw appError("VALIDATION", "Order discount cannot be negative.");

  // Pass 1 — validate everything BEFORE any mutation.
  let subtotal = 0; let cogs = 0; let units = 0;
  const prepared: { product: Product; qty: number; price: number; disc: number }[] = [];
  for (const l of lines) {
    const p = db.products.find((x) => x.id === l.productId && x.workspaceId === a.wsId && !x.archived);
    if (!p) throw appError("NOT_FOUND", "A product in this sale no longer exists.");
    if (l.qty < 1 || !Number.isInteger(l.qty)) throw appError("VALIDATION", `Invalid quantity for ${p.name}.`);
    const price = l.overridePrice != null ? round2(l.overridePrice) : p.sellingPrice;
    if (price < 0) throw appError("VALIDATION", "Price cannot be negative.");
    if (l.overridePrice != null && l.overridePrice !== p.sellingPrice) requireCap(a, "sales.overridePrice");
    const disc = round2(l.lineDiscount || 0);
    if (disc < 0) throw appError("VALIDATION", "Discount cannot be negative.");
    if (disc > price * l.qty) throw appError("VALIDATION", `Line discount exceeds the line total for ${p.name}.`);
    if (p.stock < l.qty) throw appError("INSUFFICIENT_STOCK", `Only ${p.stock} × ${p.name} in stock.`);
    subtotal = round2(subtotal + price * l.qty - disc);
    cogs = round2(cogs + p.costPrice * l.qty);
    units += l.qty;
    prepared.push({ product: p, qty: l.qty, price, disc });
  }
  if (orderDiscount > subtotal) throw appError("VALIDATION", "Order discount exceeds the sale total.");
  const total = round2(subtotal - orderDiscount);
  const paid = round2(input.amountPaid ?? total);
  if (paid < total && input.paymentMethod === "CASH") throw appError("VALIDATION", `Cash tendered (${paid}) is less than the total (${total}).`);

  // Pass 2 — commit phase. All state changes happen after full validation.
  const ws = getWorkspace(a.wsId)!;
  db.txnSeq += 1;
  const txn = `LS-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${db.txnSeq}`;
  const now = new Date().toISOString();

  const sale: Sale = {
    id: uid(), workspaceId: a.wsId, txn, customerName: input.customerName.trim(),
    customerContact: input.customerContact.trim(), paymentMethod: input.paymentMethod,
    items: [], orderDiscount, subtotal, total, amountPaid: paid,
    changeDue: Math.max(round2(paid - total), 0), cogs, grossProfit: round2(total - cogs),
    unitsSold: units, status: "COMPLETED", voidReason: null, voidedAt: null, voidedBy: null,
    note: input.note.trim(), createdById: a.userId, createdByName: a.name, createdAt: now, isDemo: seeding,
  };

  for (const { product: p, qty, price, disc } of prepared) {
    p.stock -= qty;
    p.updatedAt = now;
    const share = subtotal > 0 ? round2((orderDiscount * (price * qty - disc)) / subtotal) : 0;
    const lineNet = round2(price * qty - disc - share);
    const item: SaleItemSnapshot = {
      productId: p.id, sku: p.sku, name: p.name, qty,
      originalPrice: p.sellingPrice, soldPrice: price, unitCost: p.costPrice,
      lineDiscount: disc, orderDiscountShare: share,
      subtotal: lineNet, cogs: round2(p.costPrice * qty),
      grossProfit: round2(lineNet - p.costPrice * qty),
      overridden: price !== p.sellingPrice,
    };
    sale.items.push(item);
    db.movements.push({
      id: uid(), workspaceId: a.wsId, productId: p.id, type: "SALE", qty: -qty,
      unitCost: p.costPrice, ref: txn, saleId: sale.id, note: `Sale ${txn}`,
      actorId: a.userId, actorName: a.name, createdAt: now,
    });
  }
  db.sales.push(sale);
  audit(a.userId, a.name, a.wsId, "sale.recorded", "sale", sale.id, { txn, total, items: sale.items.length, idem: idempotencyKey ?? null });
  commit();
  return sale;
}

export function voidSale(saleId: string, reason: string): void {
  const a = requireActor();
  requireCap(a, "sales.void");
  const s = db.sales.find((x) => x.id === saleId && x.workspaceId === a.wsId);
  if (!s) throw appError("NOT_FOUND", "Sale not found.");
  if (s.status === "VOID") throw appError("CONFLICT", "This sale is already voided.");
  const now = new Date().toISOString();
  s.status = "VOID"; s.voidReason = reason; s.voidedAt = now; s.voidedBy = a.name;
  for (const it of s.items) {
    const p = db.products.find((x) => x.id === it.productId);
    if (p && !p.archived) { p.stock += it.qty; p.updatedAt = now; }
    db.movements.push({
      id: uid(), workspaceId: a.wsId, productId: it.productId, type: "REVERSAL", qty: it.qty,
      unitCost: it.unitCost, ref: s.txn, saleId: s.id, note: `Void of ${s.txn}`,
      actorId: a.userId, actorName: a.name, createdAt: now,
    });
  }
  audit(a.userId, a.name, a.wsId, "sale.voided", "sale", saleId, { txn: s.txn, reason, restoredUnits: s.unitsSold });
  commit();
}

export function listSales(wsId: string, o: { q?: string; status?: "all" | "COMPLETED" | "VOID"; method?: string; fromMs?: number; toMs?: number; page?: number; pageSize?: number }): Paged<Sale> {
  let rows = db.sales.filter((s) => s.workspaceId === wsId);
  if (o.q) {
    const q = o.q.toLowerCase();
    rows = rows.filter((s) => s.txn.toLowerCase().includes(q) || s.customerName.toLowerCase().includes(q) || s.items.some((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)));
  }
  if (o.status && o.status !== "all") rows = rows.filter((s) => s.status === o.status);
  if (o.method) rows = rows.filter((s) => s.paymentMethod === o.method);
  if (o.fromMs) rows = rows.filter((s) => new Date(s.createdAt).getTime() >= o.fromMs!);
  if (o.toMs) rows = rows.filter((s) => new Date(s.createdAt).getTime() < o.toMs!);
  rows = [...rows].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  return paginate(rows, o.page ?? 1, o.pageSize ?? 9);
}

/* ---------------- expenses ---------------- */

export function listExpenseCategories(wsId: string): (ExpenseCategory & { total: number })[] {
  return db.expenseCategories.filter((c) => c.workspaceId === wsId).map((c) => ({
    ...c,
    total: round2(db.expenses.filter((e) => e.workspaceId === wsId && e.categoryId === c.id).reduce((s, e) => s + e.amount, 0)),
  }));
}

export function createExpenseCategory(name: string): void {
  const a = requireActor();
  requireCap(a, "expenses.categories.manage");
  const v = CategoryInputSchema.parse({ name });
  if (db.expenseCategories.some((c) => c.workspaceId === a.wsId && c.name.toLowerCase() === v.name.toLowerCase() && !c.archived)) {
    throw appError("CONFLICT", "Category already exists.");
  }
  const c: ExpenseCategory = { id: uid(), workspaceId: a.wsId, name: v.name, archived: false, isDefault: false, createdAt: new Date().toISOString() };
  db.expenseCategories.push(c);
  audit(a.userId, a.name, a.wsId, "expense.category.created", "category", c.id, { name: v.name });
  commit();
}

export function archiveExpenseCategory(id: string): void {
  const a = requireActor();
  requireCap(a, "expenses.categories.manage");
  const c = db.expenseCategories.find((x) => x.id === id && x.workspaceId === a.wsId);
  if (!c) throw appError("NOT_FOUND", "Category not found.");
  if (c.isDefault) throw appError("FORBIDDEN", "Default categories cannot be archived.");
  c.archived = !c.archived;
  audit(a.userId, a.name, a.wsId, "expense.category.archived", "category", id, { archived: c.archived });
  commit();
}

export function createExpense(input: { amount: number; date: string; categoryId: string; vendor: string; note: string; reference: string; attachment: { name: string; mime: string; size: number; dataUrl: string } | null }): Expense {
  const a = requireActor();
  requireCap(a, "expenses.create");
  if (!(input.amount > 0)) throw appError("VALIDATION", "Amount must be positive.");
  if (!db.expenseCategories.some((c) => c.workspaceId === a.wsId && c.id === input.categoryId && !c.archived)) {
    throw appError("NOT_FOUND", "Choose a valid category.");
  }
  const now = new Date().toISOString();
  const e: Expense = {
    id: uid(), workspaceId: a.wsId, amount: round2(input.amount), date: input.date,
    categoryId: input.categoryId, vendor: input.vendor.trim(), note: input.note.trim(),
    reference: input.reference.trim(), attachment: input.attachment,
    createdBy: a.userId, createdByName: a.name, createdAt: now, updatedAt: now, isDemo: seeding,
  };
  db.expenses.push(e);
  audit(a.userId, a.name, a.wsId, "expense.created", "expense", e.id, { amount: e.amount, categoryId: e.categoryId, vendor: e.vendor || null });
  commit();
  return e;
}

export function updateExpense(id: string, input: { amount: number; date: string; categoryId: string; vendor: string; note: string; reference: string }): void {
  const a = requireActor();
  const e = db.expenses.find((x) => x.id === id && x.workspaceId === a.wsId);
  if (!e) throw appError("NOT_FOUND", "Expense not found.");
  // STAFF may only edit their own expenses.
  if (a.role === "STAFF" && e.createdBy !== a.userId) throw appError("FORBIDDEN", "Staff can only edit their own expenses.");
  requireCap(a, a.role === "STAFF" ? "expenses.update.own" : "expenses.update");
  const before = { amount: e.amount, date: e.date, categoryId: e.categoryId, vendor: e.vendor };
  e.amount = round2(input.amount); e.date = input.date; e.categoryId = input.categoryId;
  e.vendor = input.vendor.trim(); e.note = input.note.trim(); e.reference = input.reference.trim();
  e.updatedAt = new Date().toISOString();
  audit(a.userId, a.name, a.wsId, "expense.updated", "expense", id, { before, after: { amount: e.amount, date: e.date, vendor: e.vendor } });
  commit();
}

export function listExpenses(wsId: string, o: { q?: string; categoryId?: string; fromMs?: number; toMs?: number; sort?: string; dir?: "asc" | "desc"; page?: number; pageSize?: number }): Paged<Expense> {
  let rows = db.expenses.filter((e) => e.workspaceId === wsId);
  if (o.q) {
    const q = o.q.toLowerCase();
    rows = rows.filter((e) => e.vendor.toLowerCase().includes(q) || e.note.toLowerCase().includes(q) || e.reference.toLowerCase().includes(q));
  }
  if (o.categoryId) rows = rows.filter((e) => e.categoryId === o.categoryId);
  if (o.fromMs) rows = rows.filter((e) => new Date(e.date + "T12:00:00Z").getTime() >= o.fromMs!);
  if (o.toMs) rows = rows.filter((e) => new Date(e.date + "T12:00:00Z").getTime() < o.toMs!);
  const dir = o.dir === "asc" ? 1 : -1;
  rows = [...rows].sort((x, y) => {
    if (o.sort === "amount") return (x.amount - y.amount) * dir;
    return x.date.localeCompare(y.date) * dir || y.createdAt.localeCompare(x.createdAt);
  });
  return paginate(rows, o.page ?? 1, o.pageSize ?? 9);
}

/* ---------------- notes ---------------- */

export function createNote(input: { title: string; body: string; tags: string[]; color: Note["color"] }): Note {
  const a = requireActor();
  requireCap(a, "notes.manage");
  const now = new Date().toISOString();
  const n: Note = {
    id: uid(), workspaceId: a.wsId, title: input.title.trim(), body: input.body,
    tags: input.tags.map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean).slice(0, 8),
    color: input.color, pinned: false, archived: false,
    authorId: a.userId, authorName: a.name, createdAt: now, updatedAt: now, isDemo: seeding,
  };
  db.notes.push(n);
  audit(a.userId, a.name, a.wsId, "note.created", "note", n.id, { title: n.title });
  commit();
  return n;
}

export function updateNote(id: string, input: { title: string; body: string; tags: string[]; color: Note["color"] }): void {
  const a = requireActor();
  requireCap(a, "notes.manage");
  const n = db.notes.find((x) => x.id === id && x.workspaceId === a.wsId);
  if (!n) throw appError("NOT_FOUND", "Note not found.");
  n.title = input.title.trim(); n.body = input.body; n.color = input.color;
  n.tags = input.tags.map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean).slice(0, 8);
  n.updatedAt = new Date().toISOString();
  audit(a.userId, a.name, a.wsId, "note.updated", "note", id, { title: n.title });
  commit();
}

export function toggleNotePin(id: string): void {
  const a = requireActor();
  requireCap(a, "notes.manage");
  const n = db.notes.find((x) => x.id === id && x.workspaceId === a.wsId);
  if (!n) throw appError("NOT_FOUND", "Note not found.");
  n.pinned = !n.pinned;
  n.updatedAt = new Date().toISOString();
  if (n.pinned) audit(a.userId, a.name, a.wsId, "note.pinned", "note", id, { title: n.title });
  commit();
}

export function archiveNote(id: string): void {
  const a = requireActor();
  requireCap(a, "notes.manage");
  const n = db.notes.find((x) => x.id === id && x.workspaceId === a.wsId);
  if (!n) throw appError("NOT_FOUND", "Note not found.");
  n.archived = !n.archived;
  n.updatedAt = new Date().toISOString();
  audit(a.userId, a.name, a.wsId, "note.archived", "note", id, { archived: n.archived });
  commit();
}

export function listNotes(wsId: string, o: { q?: string; tag?: string; archived?: boolean }): Note[] {
  let rows = db.notes.filter((n) => n.workspaceId === wsId && n.archived === (o.archived ?? false));
  if (o.tag) rows = rows.filter((n) => n.tags.includes(o.tag!));
  if (o.q) {
    const q = o.q.toLowerCase();
    rows = rows.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)));
  }
  return [...rows].sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.updatedAt.localeCompare(x.updatedAt));
}

export function allNoteTags(wsId: string): string[] {
  const s = new Set<string>();
  db.notes.filter((n) => n.workspaceId === wsId && !n.archived).forEach((n) => n.tags.forEach((t) => s.add(t)));
  return [...s].sort();
}

/* ---------------- aggregates (report math lives here, not in React) ---------------- */

function salesInRange(wsId: string, fromMs: number, toMs: number): Sale[] {
  return db.sales.filter((s) => {
    if (s.workspaceId !== wsId || s.status !== "COMPLETED") return false;
    const t = new Date(s.createdAt).getTime();
    return t >= fromMs && t < toMs;
  });
}

export function kpiFor(wsId: string, fromMs: number, toMs: number) {
  const sales = salesInRange(wsId, fromMs, toMs);
  const revenue = round2(sales.reduce((s, x) => s + x.total, 0));
  const cogs = round2(sales.reduce((s, x) => s + x.cogs, 0));
  const grossProfit = round2(revenue - cogs);
  const expenses = round2(db.expenses
    .filter((e) => { const t = new Date(e.date + "T12:00:00Z").getTime(); return e.workspaceId === wsId && t >= fromMs && t < toMs; })
    .reduce((s, e) => s + e.amount, 0));
  const netProfit = round2(grossProfit - expenses);
  const count = sales.length;
  const units = sales.reduce((s, x) => s + x.unitsSold, 0);
  return {
    count, revenue, cogs, grossProfit, expenses, netProfit, units,
    grossMargin: revenue > 0 ? round2((grossProfit / revenue) * 100) : 0,
    netMargin: revenue > 0 ? round2((netProfit / revenue) * 100) : 0,
    aov: count > 0 ? round2(revenue / count) : 0,
  };
}

export function kpiSummary(wsId: string, fromMs: number, toMs: number): { cur: ReturnType<typeof kpiFor>; prev: ReturnType<typeof kpiFor> } {
  const span = toMs - fromMs;
  return { cur: kpiFor(wsId, fromMs, toMs), prev: kpiFor(wsId, fromMs - span, fromMs) };
}

export function dailySeries(wsId: string, fromDay: string, toDay: string, tz: string) {
  const days = listDays(fromDay, toDay, tz);
  return days.map((d) => {
    const sales = salesInRange(wsId, d.fromMs, d.toMs);
    const revenue = round2(sales.reduce((s, x) => s + x.total, 0));
    const cogs = round2(sales.reduce((s, x) => s + x.cogs, 0));
    const expenses = round2(db.expenses
      .filter((e) => e.workspaceId === wsId && new Date(e.date + "T12:00:00Z").getTime() >= d.fromMs && new Date(e.date + "T12:00:00Z").getTime() < d.toMs)
      .reduce((s, e) => s + e.amount, 0));
    return { label: d.label, revenue, expenses, gross: round2(revenue - cogs), net: round2(revenue - cogs - expenses) };
  });
}

export function paymentDistribution(wsId: string, fromMs: number, toMs: number): { method: PaymentMethod; count: number; total: number }[] {
  const map = new Map<PaymentMethod, { count: number; total: number }>();
  for (const s of salesInRange(wsId, fromMs, toMs)) {
    const m = map.get(s.paymentMethod) ?? { count: 0, total: 0 };
    m.count += 1; m.total = round2(m.total + s.total);
    map.set(s.paymentMethod, m);
  }
  return [...map.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.total - a.total);
}

export function expenseBreakdown(wsId: string, fromMs: number, toMs: number): { categoryId: string; name: string; total: number }[] {
  const cats = db.expenseCategories.filter((c) => c.workspaceId === wsId);
  const out = cats.map((c) => ({
    categoryId: c.id, name: c.name,
    total: round2(db.expenses
      .filter((e) => e.workspaceId === wsId && e.categoryId === c.id && new Date(e.date + "T12:00:00Z").getTime() >= fromMs && new Date(e.date + "T12:00:00Z").getTime() < toMs)
      .reduce((s, e) => s + e.amount, 0)),
  })).filter((x) => x.total > 0);
  return out.sort((a, b) => b.total - a.total);
}

export function productAggregates(wsId: string, fromMs: number, toMs: number): { productId: string; sku: string; name: string; units: number; revenue: number; cogs: number; grossProfit: number }[] {
  const map = new Map<string, { productId: string; sku: string; name: string; units: number; revenue: number; cogs: number; grossProfit: number }>();
  for (const s of salesInRange(wsId, fromMs, toMs)) {
    for (const it of s.items) {
      const m = map.get(it.productId) ?? { productId: it.productId, sku: it.sku, name: it.name, units: 0, revenue: 0, cogs: 0, grossProfit: 0 };
      m.units += it.qty;
      m.revenue = round2(m.revenue + it.subtotal);
      m.cogs = round2(m.cogs + it.cogs);
      m.grossProfit = round2(m.grossProfit + it.grossProfit);
      map.set(it.productId, m);
    }
  }
  return [...map.values()];
}

export function lowStockProducts(wsId: string): Product[] {
  return db.products.filter((p) => p.workspaceId === wsId && !p.archived && p.stock <= p.reorderLevel)
    .sort((a, b) => a.stock - b.stock);
}

export function inventoryValuation(wsId: string): { atCost: number; atRetail: number; units: number } {
  const rows = db.products.filter((p) => p.workspaceId === wsId && !p.archived);
  return {
    atCost: round2(rows.reduce((s, p) => s + p.costPrice * p.stock, 0)),
    atRetail: round2(rows.reduce((s, p) => s + p.sellingPrice * p.stock, 0)),
    units: rows.reduce((s, p) => s + p.stock, 0),
  };
}

/* ---------------- audit queries ---------------- */

export function listAudit(wsId: string, o: { q?: string; action?: string; actorId?: string; entityType?: string; fromMs?: number; toMs?: number; page?: number; pageSize?: number }): Paged<AuditEntry> {
  let rows = db.audit.filter((x) => x.workspaceId === wsId);
  if (o.action) rows = rows.filter((x) => x.action === o.action);
  if (o.actorId) rows = rows.filter((x) => x.actorId === o.actorId);
  if (o.entityType) rows = rows.filter((x) => x.entityType === o.entityType);
  if (o.fromMs) rows = rows.filter((x) => new Date(x.createdAt).getTime() >= o.fromMs!);
  if (o.toMs) rows = rows.filter((x) => new Date(x.createdAt).getTime() < o.toMs!);
  if (o.q) {
    const q = o.q.toLowerCase();
    rows = rows.filter((x) => x.action.includes(q) || x.actorName.toLowerCase().includes(q) || JSON.stringify(x.meta).toLowerCase().includes(q));
  }
  rows = [...rows].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  return paginate(rows, o.page ?? 1, o.pageSize ?? 14);
}

export function actorsIn(wsId: string): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  db.audit.filter((x) => x.workspaceId === wsId).forEach((x) => seen.set(x.actorId, x.actorName));
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

/* ---------------- SMTP & email (simulated transport) ---------------- */

export function updateSmtp(input: { host: string; port: number; secure: boolean; user: string; password?: string; fromName: string; fromEmail: string }): void {
  const a = requireActor();
  requireCap(a, "smtp.manage");
  const ws = getWorkspace(a.wsId)!;
  ws.smtp = {
    ...ws.smtp, host: input.host.trim(), port: input.port, secure: input.secure,
    user: input.user.trim(), fromName: input.fromName.trim(), fromEmail: input.fromEmail.trim(),
    configured: input.host.trim().length > 0 && input.user.trim().length > 0 && (ws.smtp.passSet || (input.password ?? "").length > 0),
  };
  if (input.password) ws.smtp.passHash = `enc:${uid()}`; // write-only: never readable back
  audit(a.userId, a.name, a.wsId, "smtp.updated", "smtp", null, { host: ws.smtp.host, port: ws.smtp.port });
  commit();
}

export async function testSmtp(): Promise<{ ok: boolean; latencyMs: number }> {
  const a = requireActor();
  requireCap(a, "smtp.manage");
  slidingLimit("smtp", a.userId, 5, 10 * 60_000);
  const ws = getWorkspace(a.wsId)!;
  if (!ws.smtp.configured) throw appError("SMTP_ERROR", "Configure SMTP before testing.");
  const latencyMs = 180 + Math.floor(Math.random() * 240);
  await new Promise((r) => setTimeout(r, Math.min(latencyMs, 500)));
  audit(a.userId, a.name, a.wsId, "smtp.tested", "smtp", null, { host: ws.smtp.host, latencyMs });
  commit();
  return { ok: true, latencyMs };
}

export async function sendReportEmail(input: unknown, rangeLabel: string): Promise<{ messageId: string }> {
  const a = requireActor();
  requireCap(a, "reports.email");
  slidingLimit("email", a.userId, 3, 60 * 60_000);
  const v = EmailReportInputSchema.parse(input);
  const ws = getWorkspace(a.wsId)!;
  if (!ws.smtp.configured) throw appError("SMTP_ERROR", "SMTP is not configured for this workspace.");
  await new Promise((r) => setTimeout(r, 600));
  const messageId = `<${uid()}@listra.local>`;
  audit(a.userId, a.name, a.wsId, "report.emailed", "report", null, { to: v.to, subject: v.subject, range: rangeLabel, includeCsv: v.includeCsv, messageId });
  commit();
  return { messageId };
}

/* ---------------- exports (CSV) ---------------- */

function logExport(kind: string, filename: string, rows: number): void {
  const a = requireActor();
  requireCap(a, "reports.export");
  slidingLimit("export", a.userId, 10, 5 * 60_000);
  audit(a.userId, a.name, a.wsId, `export.${kind}`, "report", null, { filename, rows });
  commit();
}

export function buildProductsCsv(wsId: string): { csv: string; filename: string; rows: number } {
  const rows = db.products.filter((p) => p.workspaceId === wsId);
  const csv = toCsv(
    ["SKU", "Name", "Category", "Cost", "Selling", "Stock", "Reorder", "Unit", "Barcode", "Archived"],
    rows.map((p) => [
      p.sku, p.name,
      db.productCategories.find((c) => c.id === p.categoryId)?.name ?? "",
      p.costPrice, p.sellingPrice, p.stock, p.reorderLevel, p.unit, p.barcode, p.archived ? "yes" : "no",
    ]),
  );
  const filename = `listra_products_${new Date().toISOString().slice(0, 10)}.csv`;
  logExport("products", filename, rows.length);
  return { csv, filename, rows: rows.length };
}

export function buildSalesCsv(wsId: string): { csv: string; filename: string; rows: number } {
  const rows = db.sales.filter((s) => s.workspaceId === wsId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const csv = toCsv(
    ["Txn", "Date", "Status", "Customer", "Payment", "Units", "Subtotal", "Order Discount", "Total", "COGS", "Gross Profit"],
    rows.map((s) => [
      s.txn, s.createdAt, s.status, s.customerName, s.paymentMethod, s.unitsSold,
      s.subtotal, s.orderDiscount, s.total, s.cogs, s.grossProfit,
    ]),
  );
  const filename = `listra_sales_${new Date().toISOString().slice(0, 10)}.csv`;
  logExport("sales", filename, rows.length);
  return { csv, filename, rows: rows.length };
}

export function buildExpensesCsv(wsId: string): { csv: string; filename: string; rows: number } {
  const rows = db.expenses.filter((e) => e.workspaceId === wsId).sort((a, b) => b.date.localeCompare(a.date));
  const csv = toCsv(
    ["Date", "Category", "Vendor", "Reference", "Note", "Amount", "By"],
    rows.map((e) => [
      e.date, db.expenseCategories.find((c) => c.id === e.categoryId)?.name ?? "",
      e.vendor, e.reference, e.note, e.amount, e.createdByName,
    ]),
  );
  const filename = `listra_expenses_${new Date().toISOString().slice(0, 10)}.csv`;
  logExport("expenses", filename, rows.length);
  return { csv, filename, rows: rows.length };
}

export function buildReportCsv(wsId: string, fromMs: number, toMs: number, fromLabel: string, toLabel: string): { csv: string; filename: string; rows: number } {
  const k = kpiFor(wsId, fromMs, toMs);
  const series = productAggregates(wsId, fromMs, toMs).sort((a, b) => b.revenue - a.revenue);
  const lines: (string | number | null)[][] = [
    [], ["Metric", "Value"],
    ["Total Sales", k.count], ["Revenue", k.revenue], ["COGS", k.cogs], ["Gross Profit", k.grossProfit],
    ["Gross Margin %", k.grossMargin], ["Expenses", k.expenses], ["Net Profit", k.netProfit],
    ["Net Margin %", k.netMargin], ["Average Order Value", k.aov], ["Units Sold", k.units], [],
    ["Top Products", "Units", "Revenue", "Gross Profit"],
    ...series.slice(0, 15).map((p) => [p.name, p.units, p.revenue, p.grossProfit] as (string | number | null)[]),
  ];
  const csv = toCsv(["Listra Report", fromLabel, "to", toLabel], lines);
  const filename = `listra_report_${fromLabel}_${toLabel}.csv`;
  logExport("report-summary", filename, lines.length);
  return { csv, filename, rows: lines.length };
}

/* ---------------- global search (command palette) ---------------- */

export interface SearchHit { kind: "product" | "sale" | "note" | "expense"; id: string; title: string; sub: string; }

export function searchAll(wsId: string, q: string, limit = 5): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: SearchHit[] = [];
  for (const p of db.products.filter((p) => p.workspaceId === wsId && !p.archived && (p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle))).slice(0, limit)) {
    out.push({ kind: "product", id: p.id, title: p.name, sub: p.sku });
  }
  for (const s of db.sales.filter((s) => s.workspaceId === wsId && (s.txn.toLowerCase().includes(needle) || s.customerName.toLowerCase().includes(needle))).slice(0, limit)) {
    out.push({ kind: "sale", id: s.id, title: s.txn, sub: `${s.customerName || "receipt"} · ${s.total.toFixed(2)}` });
  }
  for (const n of db.notes.filter((n) => n.workspaceId === wsId && !n.archived && (n.title.toLowerCase().includes(needle) || n.body.toLowerCase().includes(needle))).slice(0, limit)) {
    out.push({ kind: "note", id: n.id, title: n.title, sub: "note" });
  }
  for (const e of db.expenses.filter((e) => e.workspaceId === wsId && (e.vendor.toLowerCase().includes(needle) || e.note.toLowerCase().includes(needle))).slice(0, limit)) {
    out.push({ kind: "expense", id: e.id, title: e.vendor || e.note || "expense", sub: e.amount.toFixed(2) });
  }
  return out.slice(0, limit * 4);
}

/* ---------------- destructive ops ---------------- */

export function demoRecordCount(wsId: string): number {
  const c = demoCounts(wsId);
  return c.products + c.sales + c.expenses + c.notes;
}

export function demoCounts(wsId: string): { products: number; sales: number; expenses: number; notes: number } {
  return {
    products: db.products.filter((p) => p.workspaceId === wsId && p.isDemo).length,
    sales: db.sales.filter((s) => s.workspaceId === wsId && s.isDemo).length,
    expenses: db.expenses.filter((e) => e.workspaceId === wsId && e.isDemo).length,
    notes: db.notes.filter((n) => n.workspaceId === wsId && n.isDemo).length,
  };
}

export function purgeDemoData(): { removed: number } {
  const a = requireActor();
  requireCap(a, "workspace.reset");
  slidingLimit("destructive", a.userId, 3, 60 * 60_000);
  const before = demoRecordCount(a.wsId);
  db.products = db.products.filter((p) => !(p.workspaceId === a.wsId && p.isDemo));
  db.sales = db.sales.filter((s) => !(s.workspaceId === a.wsId && s.isDemo));
  db.expenses = db.expenses.filter((e) => !(e.workspaceId === a.wsId && e.isDemo));
  db.notes = db.notes.filter((n) => !(n.workspaceId === a.wsId && n.isDemo));
  db.movements = db.movements.filter((m) => m.workspaceId !== a.wsId || db.products.some((p) => p.id === m.productId));
  audit(a.userId, a.name, a.wsId, "data.purged", "workspace", a.wsId, { removed: before });
  commit();
  return { removed: before };
}

export function resetWorkspace(confirmName: string): void {
  const a = requireActor();
  requireCap(a, "workspace.reset");
  slidingLimit("destructive", a.userId, 3, 60 * 60_000);
  const ws = getWorkspace(a.wsId)!;
  if (ws.name !== confirmName) throw appError("VALIDATION", "Confirmation text doesn't match the workspace name.");
  db.products = db.products.filter((p) => p.workspaceId !== a.wsId);
  db.productCategories = db.productCategories.filter((c) => c.workspaceId !== a.wsId);
  db.movements = db.movements.filter((m) => m.workspaceId !== a.wsId);
  db.sales = db.sales.filter((s) => s.workspaceId !== a.wsId);
  db.expenses = db.expenses.filter((e) => e.workspaceId !== a.wsId);
  db.expenseCategories = db.expenseCategories.filter((c) => c.workspaceId !== a.wsId);
  db.notes = db.notes.filter((n) => n.workspaceId !== a.wsId);
  const now = new Date().toISOString();
  for (const name of ["Meals", "Travel", "Marketing", "Software", "Office"]) {
    db.expenseCategories.push({ id: uid(), workspaceId: a.wsId, name, archived: false, isDefault: true, createdAt: now });
  }
  audit(a.userId, a.name, a.wsId, "workspace.reset", "workspace", a.wsId, {});
  commit();
}

/* ---------------- backups ---------------- */

export function exportWorkspaceBackup(): { json: string; filename: string } {
  const a = requireActor();
  requireCap(a, "settings.manage");
  const slice = {
    exportedAt: new Date().toISOString(), format: "listra-backup@1",
    workspace: db.workspaces.find((w) => w.id === a.wsId),
    products: db.products.filter((p) => p.workspaceId === a.wsId),
    productCategories: db.productCategories.filter((p) => p.workspaceId === a.wsId),
    movements: db.movements.filter((p) => p.workspaceId === a.wsId),
    sales: db.sales.filter((p) => p.workspaceId === a.wsId),
    expenses: db.expenses.filter((p) => p.workspaceId === a.wsId),
    expenseCategories: db.expenseCategories.filter((p) => p.workspaceId === a.wsId),
    notes: db.notes.filter((p) => p.workspaceId === a.wsId),
  };
  audit(a.userId, a.name, a.wsId, "backup.exported", "workspace", a.wsId, { records: slice.sales.length + slice.products.length });
  commit();
  return { json: JSON.stringify(slice, null, 2), filename: `listra_backup_${new Date().toISOString().slice(0, 10)}.json` };
}

export function importWorkspaceBackup(jsonText: string): { counts: { products: number; sales: number; expenses: number; notes: number } } {
  const a = requireActor();
  requireCap(a, "settings.manage");
  slidingLimit("destructive", a.userId, 3, 60 * 60_000);
  let data: { format?: string; workspace?: Workspace; products?: Product[]; productCategories?: ProductCategory[]; movements?: StockMovement[]; sales?: Sale[]; expenses?: Expense[]; expenseCategories?: ExpenseCategory[]; notes?: Note[] };
  try { data = JSON.parse(jsonText); } catch { throw appError("VALIDATION", "Not a valid backup file."); }
  if (data.format !== "listra-backup@1" || !Array.isArray(data.products)) throw appError("VALIDATION", "Unrecognized backup format.");
  const strip = <T extends { workspaceId: string }>(rows: T[]): T[] => rows.map((r) => ({ ...r, workspaceId: a.wsId }));
  db.products = db.products.filter((p) => p.workspaceId !== a.wsId).concat(strip(data.products));
  db.productCategories = db.productCategories.filter((p) => p.workspaceId !== a.wsId).concat(strip(data.productCategories ?? []));
  db.movements = db.movements.filter((p) => p.workspaceId !== a.wsId).concat(strip(data.movements ?? []));
  db.sales = db.sales.filter((p) => p.workspaceId !== a.wsId).concat(strip(data.sales ?? []));
  db.expenses = db.expenses.filter((p) => p.workspaceId !== a.wsId).concat(strip(data.expenses ?? []));
  db.expenseCategories = db.expenseCategories.filter((p) => p.workspaceId !== a.wsId).concat(strip(data.expenseCategories ?? []));
  db.notes = db.notes.filter((p) => p.workspaceId !== a.wsId).concat(strip(data.notes ?? []));
  audit(a.userId, a.name, a.wsId, "backup.imported", "workspace", a.wsId, { products: data.products.length, sales: (data.sales ?? []).length });
  commit();
  return { counts: { products: data.products.length, sales: (data.sales ?? []).length, expenses: (data.expenses ?? []).length, notes: (data.notes ?? []).length } };
}

/* ---------------- seeding ---------------- */

function seedSampleDataInto(ws: Workspace, owner: Profile): void {
  const now = Date.now();
  const day = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString();
  let rnd = 42;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };

  const cats = ["Beverages", "Bakery", "Snacks", "Household"].map((name) => {
    const c: ProductCategory = { id: uid(), workspaceId: ws.id, name, archived: false, createdAt: iso(now - 32 * day) };
    db.productCategories.push(c);
    return c;
  });

  const seedProducts: [string, string, number, number, number, number][] = [
    ["Arabica Coffee 250g", "BEV-001", 180, 295, 48, 10],
    ["Ube Pandesal (6pc)", "BAK-001", 55, 95, 60, 15],
    ["Ensaymada Large", "BAK-002", 42, 75, 25, 8],
    ["Bottled Water 500ml", "BEV-002", 9, 20, 120, 30],
    ["Iced Tea 350ml", "BEV-003", 18, 35, 40, 12],
    ["Choco Crinkle (4pc)", "BAK-003", 38, 68, 8, 10],
    ["Potato Chips 90g", "SNK-001", 24, 42, 55, 15],
    ["Instant Noodles", "SNK-002", 11, 19, 90, 25],
    ["Dish Soap 500ml", "HOU-001", 35, 58, 22, 6],
    ["Laundry Bar Soap", "HOU-002", 16, 28, 0, 6],
    ["Cinnamon Roll", "BAK-004", 30, 55, 18, 6],
    ["Sparkling Water", "BEV-004", 22, 40, 26, 8],
  ];

  for (const [name, sku, cost, price, stock, reorder] of seedProducts) {
    const cat = cats[sku.startsWith("BEV") ? 0 : sku.startsWith("BAK") ? 1 : sku.startsWith("SNK") ? 2 : 3];
    const p: Product = {
      id: uid(), workspaceId: ws.id, name, sku, categoryId: cat.id, description: "",
      costPrice: cost, sellingPrice: price, stock, reorderLevel: reorder,
      unit: "pc", barcode: `480${String(Math.floor(rand() * 1e9)).padStart(9, "0")}`,
      archived: false, isDemo: true, createdAt: iso(now - 31 * day), updatedAt: iso(now - 31 * day),
    };
    db.products.push(p);
    db.movements.push({
      id: uid(), workspaceId: ws.id, productId: p.id, type: "RESTOCK", qty: stock,
      unitCost: cost, ref: "SEED-OPEN", saleId: null, note: "Opening stock",
      actorId: owner.id, actorName: owner.name, createdAt: iso(now - 31 * day),
    });
  }

  // Replay ~60 sales through the live engine so stock reconciles exactly.
  for (let i = 0; i < 60; i++) {
    const t = now - Math.floor(rand() * 30) * day - Math.floor(rand() * 12) * 3_600_000;
    const nItems = 1 + Math.floor(rand() * 3);
    const lines = [] as { productId: string; qty: number; overridePrice: number | null; lineDiscount: number }[];
    for (let k = 0; k < nItems; k++) {
      const p = db.products[Math.floor(rand() * db.products.length)];
      const qty = 1 + Math.floor(rand() * 3);
      if (p.stock < qty) continue;
      lines.push({ productId: p.id, qty, overridePrice: null, lineDiscount: 0 });
    }
    if (lines.length === 0) continue;
    const saleAt = iso(t);
    try {
      const s = recordSale({
        lines, orderDiscount: rand() < 0.2 ? 10 : 0,
        customerName: rand() < 0.5 ? ["Aling Nena", "Kuya Ben", "Ms. Reyes", "Barangay Canteen", ""][Math.floor(rand() * 5)] : "",
        customerContact: "", paymentMethod: (["CASH", "CASH", "CASH", "E_WALLET", "CARD"] as PaymentMethod[])[Math.floor(rand() * 5)],
        amountPaid: null, note: "",
      });
      // Backdate the seeded sale so reports show 30 days of history.
      s.createdAt = saleAt;
      for (const m of db.movements.filter((m) => m.saleId === s.id)) m.createdAt = saleAt;
    } catch { /* insufficient stock during seeding is fine — skip */ }
  }

  // Restore stock plausibility: top up what the seeded sales consumed.
  for (const p of db.products.filter((x) => x.workspaceId === ws.id)) {
    const sold = db.movements.filter((m) => m.productId === p.id && m.type === "SALE").reduce((s, m) => s + m.qty, 0);
    const topUp = Math.max(0, Math.ceil(-sold * 1.6));
    if (topUp > 0) {
      p.stock += topUp;
      db.movements.push({
        id: uid(), workspaceId: ws.id, productId: p.id, type: "RESTOCK", qty: topUp,
        unitCost: p.costPrice, ref: "SEED-RESTOCK", saleId: null, note: "Weekly delivery",
        actorId: owner.id, actorName: owner.name, createdAt: iso(now - Math.floor(rand() * 20) * day),
      });
    }
  }

  const expCats = db.expenseCategories.filter((c) => c.workspaceId === ws.id);
  const seedExpenses: [string, string, number, string][] = [
    ["Rent share — stall space", "Office", 4500, "Landlord"],
    ["Electricity bill", "Office", 1850.5, "Meralco"],
    ["Facebook ads boost", "Marketing", 1200, "Meta"],
    ["Delivery gas & tolls", "Travel", 640, ""],
    ["Team lunch", "Meals", 890, "Jollibee"],
    ["POS software subscription", "Software", 599, "Peddlr"],
    ["Packaging & bags", "Office", 720.75, "Divisoria Supplies"],
    ["Tarpaulin printing", "Marketing", 350, "Printworks"],
    ["Grab deliveries", "Travel", 420, "Grab"],
    ["Staff snacks", "Meals", 300, ""],
  ];
  for (let i = 0; i < seedExpenses.length; i++) {
    const [note, catName, amount, vendor] = seedExpenses[i];
    const cat = expCats.find((c) => c.name === catName)!;
    const d = new Date(now - Math.floor(rand() * 28) * day);
    db.expenses.push({
      id: uid(), workspaceId: ws.id, amount, date: d.toISOString().slice(0, 10),
      categoryId: cat.id, vendor, note, reference: `OR-${2000 + i}`, attachment: null,
      createdBy: owner.id, createdByName: owner.name, createdAt: iso(d.getTime()), updatedAt: iso(d.getTime()), isDemo: true,
    });
  }

  const seedNotes: [string, string, string[], Note["color"], boolean][] = [
    ["Supplier contacts", "### Beverages\n- **Café Rico** — 0917 555 2210, Tue/Fri delivery\n- *Ask for the 10-sack promo*\n\n### Packaging\n- Divisoria Supplies — cash basis", ["suppliers", "contacts"], "blue", true],
    ["Weekend prep checklist", "1. Bake ensaymada batch ×3\n2. Ice stock for iced tea\n3. Count cash float — ₱2,000\n4. Charge GCash QR stand", ["operations"], "gold", true],
    ["Recipe: Ube Pandesal", "Cost per batch ≈ **₱310** for 36 pcs.\n> Keep ube halaya chilled overnight for cleaner swirls.", ["recipes"], "green", false],
    ["Ideas", "- Loyalty card: 10th coffee free\n- Bundle chips + drink at ₱55\n- `TODO` photo menu for GCash page", ["ideas"], "violet", false],
  ];
  for (const [title, body, tags, color, pinned] of seedNotes) {
    db.notes.push({
      id: uid(), workspaceId: ws.id, title, body, tags, color, pinned, archived: false,
      authorId: owner.id, authorName: owner.name, createdAt: iso(now - 20 * day), updatedAt: iso(now - 2 * day), isDemo: true,
    });
  }
}

/* ---------------- init ---------------- */

async function initDb(): Promise<void> {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed.v === VERSION) db = parsed;
    }
  } catch { db = emptyDb(); }
  currentToken = localStorage.getItem(SESSION_KEY);

  if (db.profiles.length === 0) {
    const now = new Date().toISOString();
    const mk = async (email: string, name: string, pass: string): Promise<Profile> => {
      const salt = uid();
      return { id: uid(), email, name, passHash: await hashPassword(pass, salt), salt, emailVerified: true, verifyCode: null, verifyExpiresAt: 0, resetCode: null, resetExpiresAt: 0, createdAt: now };
    };
    const owner = await mk("owner@listra.app", "Alex Mercado", "demo1234");
    const staff = await mk("staff@listra.app", "Jamie Santos", "demo1234");
    db.profiles.push(owner, staff);

    const ws: Workspace = {
      id: uid(), name: "Mercado Daily Goods", currency: "PHP", timezone: "Asia/Manila", locale: "en-PH", createdAt: now,
      business: { name: "Mercado Daily Goods", email: "owner@listra.app", phone: "+63 917 555 0100", address: "123 Rizal Ave, Quezon City", receiptFooter: "Suki pricing available — ask at the counter!", taxId: "TIN 123-456-789" },
      smtp: { host: "", port: 587, secure: true, user: "", passHash: null, passSet: false, fromName: "Mercado Daily Goods", fromEmail: "owner@listra.app", configured: false },
    };
    db.workspaces.push(ws);
    db.members.push({ workspaceId: ws.id, userId: owner.id, role: "OWNER", status: "ACTIVE", joinedAt: now });
    db.members.push({ workspaceId: ws.id, userId: staff.id, role: "STAFF", status: "ACTIVE", joinedAt: now });
    for (const name of ["Meals", "Travel", "Marketing", "Software", "Office"]) {
      db.expenseCategories.push({ id: uid(), workspaceId: ws.id, name, archived: false, isDefault: true, createdAt: now });
    }
    // Seed through the live engine under a temporary privileged session.
    const seedSession = createSession(owner.id, ws.id);
    const prevToken = currentToken;
    currentToken = seedSession.token;
    seeding = true;
    try { seedSampleDataInto(ws, owner); }
    finally {
      seeding = false;
      currentToken = prevToken;
      db.sessions = db.sessions.filter((s) => s.token !== seedSession.token);
    }
    commit();
    logEvent("info", "db.seeded", { workspace: ws.name });
  }
}

export const dbReady: Promise<void> = initDb().catch((e) => {
  logEvent("error", "db.init_failed", { message: (e as Error)?.message ?? String(e) });
});

/* ---------------- integrity self-test ---------------- */

export interface SelfTestResult { name: string; pass: boolean; detail?: string; ms: number; }

export function selfTest(): SelfTestResult[] {
  const results: SelfTestResult[] = [];
  const a = requireActor();
  const W = `test-${uid()}`;

  // Scratch workspace owned by the current actor.
  db.workspaces.push({ id: W, name: "__selftest__", currency: "PHP", timezone: "Asia/Manila", locale: "en-PH", createdAt: new Date().toISOString(), business: { name: "T", email: "", phone: "", address: "", receiptFooter: "", taxId: "" }, smtp: { host: "", port: 587, secure: true, user: "", passHash: null, passSet: false, fromName: "", fromEmail: "", configured: false } });
  db.members.push({ workspaceId: W, userId: a.userId, role: "OWNER", status: "ACTIVE", joinedAt: new Date().toISOString() });
  db.members.push({ workspaceId: W, userId: "nobody", role: "STAFF", status: "ACTIVE", joinedAt: new Date().toISOString() });

  const prevWs = getSession()?.workspaceId ?? null;
  getSession()!.workspaceId = W;

  const t = (name: string, fn: () => void) => {
    const start = performance.now();
    try { fn(); results.push({ name, pass: true, ms: Math.round(performance.now() - start) }); }
    catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - start) }); }
  };
  const assert: (cond: unknown, msg: string) => asserts cond = (cond, msg) => { if (!cond) throw new Error(msg); };

  try {
    let prodId = "";
    t("atomic · restock writes a movement", () => {
      const p = createProduct({ name: "Probe Widget", sku: "ST-PROBE", categoryId: null, description: "", costPrice: 12, sellingPrice: 20, stock: 5, reorderLevel: 2, unit: "pc", barcode: "" });
      prodId = p.id;
      assert(db.movements.some((m) => m.workspaceId === W && m.productId === p.id && m.type === "RESTOCK" && m.qty === 5), "no RESTOCK movement");
    });

    let saleId = "";
    t("atomic · sale snapshots cost and deducts stock", () => {
      const s = recordSale({ lines: [{ productId: prodId, qty: 3, overridePrice: null, lineDiscount: 0 }], orderDiscount: 0, customerName: "", customerContact: "", paymentMethod: "CASH", amountPaid: null, note: "" });
      saleId = s.id;
      assert(db.products.find((p) => p.id === prodId)!.stock === 2, "stock not deducted");
      assert(s.items[0].unitCost === 12, "cost snapshot wrong");
      assert(db.movements.some((m) => m.saleId === s.id && m.type === "SALE" && m.qty === -3), "no SALE movement");
    });

    t("atomic · insufficient stock rolls back everything", () => {
      const before = db.products.find((p) => p.id === prodId)!.stock;
      const salesBefore = db.sales.length;
      try {
        recordSale({ lines: [{ productId: prodId, qty: 99, overridePrice: null, lineDiscount: 0 }], orderDiscount: 0, customerName: "", customerContact: "", paymentMethod: "CASH", amountPaid: null, note: "" });
        throw new Error("should have thrown");
      } catch (e) {
        if (!isAppError(e)) throw e;
        assert(e.code === "INSUFFICIENT_STOCK", "wrong code");
      }
      assert(db.products.find((p) => p.id === prodId)!.stock === before, "stock mutated on failure");
      assert(db.sales.length === salesBefore, "partial sale written");
    });

    t("atomic · void restores stock via REVERSAL", () => {
      voidSale(saleId, "customer changed mind");
      assert(db.products.find((p) => p.id === prodId)!.stock === 5, "stock not restored");
      assert(db.movements.some((m) => m.saleId === saleId && m.type === "REVERSAL" && m.qty === 3), "no REVERSAL");
      assert(db.sales.find((s) => s.id === saleId)!.status === "VOID", "status not void");
    });

    t("audit · every sensitive op left a trail", () => {
      const trail = db.audit.filter((x) => x.workspaceId === W);
      assert(trail.some((x) => x.action === "product.created"), "product audit missing");
      assert(trail.some((x) => x.action === "sale.recorded"), "sale audit missing");
      assert(trail.some((x) => x.action === "sale.voided"), "void audit missing");
    });

    t("isolation · another workspace's actor cannot read in", () => {
      const rows = listSales("ws-other", {});
      assert(rows.total === 0, "cross-workspace leak");
      const k = kpiFor("ws-other", 0, Date.now());
      assert(k.revenue === 0, "aggregate leak");
    });

    t("authz · STAFF role map excludes admin powers", () => {
      assert(!roleCan("STAFF", "sales.overridePrice"), "staff override leak");
      assert(!roleCan("STAFF", "workspace.reset"), "staff reset leak");
      assert(roleCan("STAFF", "sales.create"), "staff lost sales.create");
      assert(roleCan("ADMIN", "workspace.reset"), "admin lost reset");
    });
  } finally {
    // Tear down scratch workspace.
    getSession()!.workspaceId = prevWs;
    db.workspaces = db.workspaces.filter((w) => w.id !== W);
    db.members = db.members.filter((m) => m.workspaceId !== W);
    db.products = db.products.filter((p) => p.workspaceId !== W);
    db.sales = db.sales.filter((s) => s.workspaceId !== W);
    db.movements = db.movements.filter((m) => m.workspaceId !== W);
    db.audit = db.audit.filter((x) => x.workspaceId !== W);
    commit();
  }
  return results;
}
