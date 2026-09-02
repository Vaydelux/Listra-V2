/* Money, dates, CSV and Markdown utilities. Pure functions — unit-tested. */

export function uid(): string {
  return (crypto as { randomUUID?: () => string }).randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ---------- money ---------- */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function makeFormatter(currency: string, locale: string) {
  const fmt = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const compact = new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
  return {
    code: currency,
    format: (v: number, opts?: { compact?: boolean; sign?: boolean }) => {
      const s = opts?.compact ? compact.format(v) : fmt.format(v);
      return opts?.sign && v > 0 ? `+${s}` : s;
    },
  };
}
export type CurrencyFormatter = ReturnType<typeof makeFormatter>;

/** Profit margin: (sell - cost) / sell × 100 */
export function marginPct(selling: number, cost: number): number {
  if (selling <= 0) return 0;
  return round2(((selling - cost) / selling) * 100);
}

/** Markup: (sell - cost) / cost × 100 */
export function markupPct(selling: number, cost: number): number {
  if (cost <= 0) return 0;
  return round2(((selling - cost) / cost) * 100);
}

/* ---------- dates & timezones ----------
   Timestamps are stored as UTC ISO strings. Business-day boundaries come from
   the workspace timezone: local inclusive dates → half-open UTC window. */

export type RangePreset = "TODAY" | "WEEK" | "MONTH" | "LAST_MONTH" | "LAST30" | "LAST90" | "CUSTOM";

function wallParts(ms: number, tz: string): { y: number; mo: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 1);
  return { y: get("year"), mo: get("month"), d: get("day") };
}

export function tzOffsetMs(utcMs: number, tz: string): number {
  const w = wallParts(utcMs, tz);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, Math.floor(((utcMs % 86_400_000) + 86_400_000) % 86_400_000 / 3_600_000), 0, 0);
  return asUtc - Math.floor(utcMs / 3_600_000) * 3_600_000;
}

/** midnight of the wall-clock day containing utcMs, expressed as a UTC instant */
function localMidnight(utcMs: number, tz: string): number {
  const w = wallParts(utcMs, tz);
  return Date.UTC(w.y, w.mo - 1, w.d) - tzOffsetMs(Date.UTC(w.y, w.mo - 1, w.d, 12), tz);
}

export function presetRange(preset: RangePreset, tz: string, custom?: { from: string; to: string }): { from: string; to: string } {
  const now = Date.now();
  const w = wallParts(now, tz);
  const today = `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
  const dt = (s: string) => localMidnight(new Date(s + "T12:00:00Z").getTime(), tz);

  switch (preset) {
    case "TODAY": return { from: today, to: today };
    case "WEEK": {
      const dow = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now) === "Sun" ? 0 : new Date(dt(today) + 86_400_000).getUTCDay() || 7);
      const start = new Date(dt(today) - (dow - 1) * 86_400_000);
      const sw = wallParts(start.getTime(), tz);
      return { from: `${sw.y}-${String(sw.mo).padStart(2, "0")}-${String(sw.d).padStart(2, "0")}`, to: today };
    }
    case "MONTH": return { from: `${w.y}-${String(w.mo).padStart(2, "0")}-01`, to: today };
    case "LAST_MONTH": {
      const m0 = w.mo === 1 ? 12 : w.mo - 1;
      const y0 = w.mo === 1 ? w.y - 1 : w.y;
      const lastDay = new Date(Date.UTC(y0, m0, 0)).getUTCDate();
      return { from: `${y0}-${String(m0).padStart(2, "0")}-01`, to: `${y0}-${String(m0).padStart(2, "0")}-${lastDay}` };
    }
    case "LAST30": return { from: isoDay(now - 29 * 86_400_000, tz), to: today };
    case "LAST90": return { from: isoDay(now - 89 * 86_400_000, tz), to: today };
    case "CUSTOM": return { from: custom?.from ?? isoDay(now - 29 * 86_400_000, tz), to: custom?.to ?? today };
  }
}

function isoDay(ms: number, tz: string): string {
  const w = wallParts(ms, tz);
  return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/** Inclusive local dates → half-open UTC window [fromMs, toMs). */
export function rangeToUtc(fromDay: string, toDay: string, tz: string): { fromMs: number; toMs: number } {
  const f = new Date(fromDay + "T12:00:00Z").getTime();
  const t = new Date(toDay + "T12:00:00Z").getTime();
  return {
    fromMs: localMidnight(f, tz),
    toMs: localMidnight(t, tz) + 86_400_000,
  };
}

export function listDays(fromDay: string, toDay: string, tz: string): { key: string; label: string; fromMs: number; toMs: number }[] {
  const { fromMs } = rangeToUtc(fromDay, toDay, tz);
  const end = rangeToUtc(fromDay, toDay, tz).toMs;
  const out: { key: string; label: string; fromMs: number; toMs: number }[] = [];
  let cur = fromMs;
  let guard = 0;
  while (cur < end && guard < 400) {
    // `cur` is already local midnight expressed in UTC.
    const w = wallParts(cur, tz);
    const key = `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
    out.push({ key, label: `${w.mo}/${w.d}`, fromMs: cur, toMs: cur + 86_400_000 });
    cur += 86_400_000;
    guard++;
  }
  return out;
}

export function fmtDate(iso: string, tz: string, withTime = false): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, day: "2-digit", month: "short", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return iso.slice(0, 10);
}

/* ---------- CSV (UTF-8 BOM, formula-injection guarded) ---------- */

export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  let s = v;
  if (/^[=+\-@]/.test(s)) s = "'" + s; // spreadsheet formula injection guard
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(header: (string | number)[], rows: (string | number | null)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return "\uFEFF" + lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- Markdown (sanitize-first renderer) ---------- */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Minimal, safe Markdown renderer. Source is HTML-escaped first, so raw
 *  HTML stays inert; links restricted to http(s)/mailto. */
export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split(/\r?\n/);
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  const closeLists = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };
  const inline = (s: string): string =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^###\s/.test(line)) { closeLists(); out.push(`<h3>${inline(line.slice(4))}</h3>`); continue; }
    if (/^##\s/.test(line)) { closeLists(); out.push(`<h2>${inline(line.slice(3))}</h2>`); continue; }
    if (/^#\s/.test(line)) { closeLists(); out.push(`<h1>${inline(line.slice(2))}</h1>`); continue; }
    if (/^---+$/.test(line)) { closeLists(); out.push("<hr/>"); continue; }
    if (/^&gt;\s?/.test(line)) { closeLists(); out.push(`<blockquote>${inline(line.replace(/^&gt;\s?/, ""))}</blockquote>`); continue; }
    if (/^[-*]\s/.test(line)) {
      if (!inUl) { closeLists(); out.push("<ul>"); inUl = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      if (!inOl) { closeLists(); out.push("<ol>"); inOl = true; }
      out.push(`<li>${inline(line.replace(/^\d+\.\s/, ""))}</li>`);
      continue;
    }
    if (line === "") { closeLists(); continue; }
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeLists();
  return out.join("\n");
}
