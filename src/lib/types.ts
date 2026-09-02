import { z } from "zod";

/* ---------------- shared error contract ---------------- */

export type ErrorCode =
  | "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT"
  | "RATE_LIMITED" | "INSUFFICIENT_STOCK" | "SMTP_ERROR" | "STORAGE_ERROR"
  | "DB_ERROR" | "DESTRUCTIVE_CONFIRM" | "OFFLINE" | "UNEXPECTED";

export interface AppError {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string[] | undefined>;
}

export const isAppError = (e: unknown): e is AppError =>
  typeof e === "object" && e !== null && "code" in e && "message" in e;

/* ---------------- auth & workspace ---------------- */

export interface Profile { id: string; email: string; name: string; passHash: string; salt: string; emailVerified: boolean; verifyCode: string | null; verifyExpiresAt: number; resetCode: string | null; resetExpiresAt: number; createdAt: string; }
export interface Session { token: string; userId: string; workspaceId: string | null; createdAt: string; expiresAt: string; }
export interface Workspace {
  id: string; name: string; currency: string; timezone: string; locale: string; createdAt: string;
  business: { name: string; email: string; phone: string; address: string; receiptFooter: string; taxId: string };
  smtp: { host: string; port: number; secure: boolean; user: string; passHash: string | null; passSet: boolean; fromName: string; fromEmail: string; configured: boolean };
}

export type Role = "OWNER" | "ADMIN" | "STAFF";
export interface Member { workspaceId: string; userId: string; role: Role; status: "ACTIVE" | "INACTIVE"; joinedAt: string; }

/* ---------------- capabilities ---------------- */

export const ALL_CAPS = [
  "inventory.view", "inventory.create", "inventory.update", "inventory.adjust",
  "stock.restock",
  "sales.create", "sales.view", "sales.overridePrice", "sales.void",
  "expenses.create", "expenses.view", "expenses.update", "expenses.update.own", "expenses.manage", "expenses.categories.manage",
  "notes.manage",
  "reports.view", "reports.export", "reports.email",
  "settings.manage", "members.manage", "audit.view", "smtp.manage", "workspace.reset",
] as const;
export type Capability = (typeof ALL_CAPS)[number];

export const STAFF_CAPS: Capability[] = [
  "inventory.view", "inventory.create", "inventory.update", "stock.restock",
  "sales.create", "sales.view",
  "expenses.create", "expenses.view", "expenses.update.own",
  "notes.manage",
  "reports.view", "reports.export",
];

export function can(role: Role, cap: Capability): boolean {
  if (role === "OWNER" || role === "ADMIN") return true;
  return STAFF_CAPS.includes(cap);
}

/* ---------------- inventory ---------------- */

export type StockMovementType = "RESTOCK" | "SALE" | "REVERSAL" | "ADJUSTMENT" | "RETURN";
export interface Product {
  id: string; workspaceId: string; name: string; sku: string; categoryId: string | null;
  description: string; costPrice: number; sellingPrice: number; stock: number; reorderLevel: number;
  unit: string; barcode: string; archived: boolean; isDemo: boolean; createdAt: string; updatedAt: string;
}
export interface ProductCategory { id: string; workspaceId: string; name: string; archived: boolean; createdAt: string; }
export interface StockMovement {
  id: string; workspaceId: string; productId: string; type: StockMovementType; qty: number;
  unitCost: number | null; ref: string; saleId: string | null; note: string;
  actorId: string; actorName: string; createdAt: string;
}

export const ProductInputSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(140),
  sku: z.string().trim().min(2, "SKU required").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only"),
  categoryId: z.string().nullable(),
  description: z.string().trim().max(600),
  costPrice: z.number().min(0, "Must be positive").max(10_000_000)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: "Two decimal places max" }),
  sellingPrice: z.number().min(0, "Must be positive").max(10_000_000)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: "Two decimal places max" }),
  stock: z.number().int().min(0).max(1_000_000),
  reorderLevel: z.number().int().min(0).max(1_000_000),
  unit: z.string().trim().max(20),
  barcode: z.string().trim().max(40),
});
export type ProductInput = z.infer<typeof ProductInputSchema>;

export const RestockInputSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().min(1).max(100_000),
  currentCost: z.number().min(0).max(10_000_000).nullable().optional(),
  reference: z.string().trim().max(200).optional(),
});

export const AdjustStockInputSchema = z.object({
  productId: z.string(),
  delta: z.number().int().min(-100_000).max(100_000).refine((v) => v !== 0, "Delta cannot be zero"),
  reason: z.string().trim().min(3).max(300),
});

export const CategoryInputSchema = z.object({ name: z.string().trim().min(1).max(60) });

/* ---------------- sales ---------------- */

export type PaymentMethod = "CASH" | "CARD" | "BANK_TRANSFER" | "E_WALLET" | "OTHER";
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" }, { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "E_WALLET", label: "E-wallet" },
  { value: "OTHER", label: "Other" },
];

export interface SaleItemSnapshot {
  productId: string; sku: string; name: string; qty: number;
  originalPrice: number; soldPrice: number; unitCost: number;
  lineDiscount: number; orderDiscountShare: number;
  subtotal: number; cogs: number; grossProfit: number; overridden: boolean;
}
export interface Sale {
  id: string; workspaceId: string; txn: string; customerName: string; customerContact: string;
  paymentMethod: PaymentMethod; items: SaleItemSnapshot[];
  orderDiscount: number; subtotal: number; total: number; amountPaid: number; changeDue: number;
  cogs: number; grossProfit: number; unitsSold: number;
  status: "COMPLETED" | "VOID"; voidReason: string | null; voidedAt: string | null; voidedBy: string | null;
  note: string; createdById: string; createdByName: string; createdAt: string; isDemo: boolean;
}
export interface SaleInputLine { productId: string; qty: number; overridePrice: number | null; lineDiscount: number; }
export interface SaleInput {
  lines: SaleInputLine[]; orderDiscount: number; customerName: string; customerContact: string;
  paymentMethod: PaymentMethod; amountPaid: number | null; note: string;
}

/* ---------------- expenses ---------------- */

export interface ExpenseCategory { id: string; workspaceId: string; name: string; archived: boolean; isDefault: boolean; createdAt: string; }
export interface ExpenseAttachment { name: string; mime: string; size: number; dataUrl: string; }
export interface Expense {
  id: string; workspaceId: string; amount: number; date: string; categoryId: string;
  vendor: string; note: string; reference: string; attachment: ExpenseAttachment | null;
  createdBy: string; createdByName: string; createdAt: string; updatedAt: string; isDemo: boolean;
}

/* ---------------- notes ---------------- */

export type NoteColor = "gold" | "green" | "red" | "blue" | "violet";
export interface Note {
  id: string; workspaceId: string; title: string; body: string; tags: string[]; color: NoteColor;
  pinned: boolean; archived: boolean; authorId: string; authorName: string; createdAt: string; updatedAt: string; isDemo: boolean;
}

/* ---------------- audit ---------------- */

export interface AuditEntry {
  id: string; workspaceId: string; actorId: string; actorName: string; action: string;
  entityType: string; entityId: string | null; meta: Record<string, unknown>; createdAt: string;
}

export const AUDIT_ACTIONS = [
  "auth.login", "auth.signup", "auth.password_reset",
  "workspace.created", "workspace.updated", "workspace.reset",
  "product.created", "product.updated", "product.archived", "product.restocked",
  "stock.adjusted", "category.created", "category.archived",
  "sale.recorded", "sale.voided",
  "expense.created", "expense.updated", "expense.category.created", "expense.category.archived",
  "note.created", "note.updated", "note.pinned", "note.archived",
  "member.role_changed", "member.added", "member.removed",
  "smtp.updated", "smtp.tested", "report.emailed",
  "export.products", "export.sales", "export.expenses", "export.report-summary",
  "data.purged", "backup.exported", "backup.imported",
];

/* ---------------- workspace settings ---------------- */

export const OnboardingSchema = z.object({
  businessName: z.string().trim().min(2, "Business name required").max(80),
  currency: z.string().length(3, "ISO 4217 code"),
  timezone: z.string().min(3).max(60),
  locale: z.string().min(2).max(10),
  loadSampleData: z.boolean().optional(),
});

export const SignupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8, "Minimum 8 characters"),
});

export const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const EmailReportInputSchema = z.object({
  to: z.string().email("Valid recipient required"),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().max(1000),
  includeCsv: z.boolean(),
  includeLowStock: z.boolean(),
});

export const CURRENCIES = [
  { code: "PHP", label: "PHP — Philippine Peso (₱)" },
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "GBP", label: "GBP — British Pound (£)" },
  { code: "JPY", label: "JPY — Japanese Yen (¥)" },
  { code: "SGD", label: "SGD — Singapore Dollar (S$)" },
  { code: "AUD", label: "AUD — Australian Dollar (A$)" },
  { code: "CAD", label: "CAD — Canadian Dollar (C$)" },
];

export const TIMEZONES = [
  "Asia/Manila", "Asia/Singapore", "Asia/Tokyo", "Asia/Hong_Kong", "Asia/Shanghai",
  "Australia/Sydney", "Pacific/Auckland", "America/New_York", "America/Los_Angeles",
  "America/Chicago", "Europe/London", "Europe/Berlin", "Europe/Paris", "UTC",
];
