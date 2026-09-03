/* Theme engine: 19 presets → semantic CSS variables, with runtime WCAG
   contrast derivation so accent foregrounds stay legible on every surface. */

export interface ThemeVars {
  bg: string; surface: string; surface2: string; raised: string; field: string;
  border: string; borderStrong: string;
  text: string; muted: string; faint: string;
  accent: string; positive: string; negative: string; warn: string; info: string;
  chart: [string, string, string, string, string];
  radius: string;
  shadow: "soft" | "crisp" | "none";
}

export interface ThemeDef { id: string; name: string; dark: boolean; v: ThemeVars; }

/* ---------- color math (WCAG) ---------- */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
}

export function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA); const b = hexToRgb(hexB);
  return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a); const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick black or white — whichever clears the target ratio — for text on `bg`. */
export function pickForeground(bg: string, target = 4.5): string {
  return contrastRatio("#101012", bg) >= target ? "#101012" : "#f5f4f1";
}

/** Nudge `fg` toward black/white until it meets `target` contrast on `bg`. */
export function ensureContrast(fg: string, bg: string, target = 4.5): string {
  let cur = fg;
  const toward = relativeLuminance(bg) > 0.4 ? "#000000" : "#ffffff";
  for (let i = 0; i < 26 && contrastRatio(cur, bg) < target; i++) cur = mix(cur, toward, 0.16);
  return cur;
}

/* ---------- theme presets ---------- */

function vars(dark: boolean, o: Partial<ThemeVars> & { accent: string }): ThemeVars {
  const bg = o.bg ?? (dark ? "#0f1013" : "#f4f5f7");
  const surface = o.surface ?? (dark ? "#17181c" : "#ffffff");
  return {
    bg, surface,
    surface2: o.surface2 ?? (dark ? "#1e2025" : "#eef0f3"),
    raised: o.raised ?? (dark ? "#24262c" : "#ffffff"),
    field: o.field ?? (dark ? "#121317" : "#f7f8fa"),
    border: o.border ?? (dark ? "#26282f" : "#e2e4e9"),
    borderStrong: o.borderStrong ?? (dark ? "#35383f" : "#c9cdd6"),
    text: o.text ?? (dark ? "#f1f0ec" : "#191b20"),
    muted: o.muted ?? (dark ? "#9ba0aa" : "#5c6270"),
    faint: o.faint ?? (dark ? "#6d727c" : "#8a909c"),
    accent: o.accent,
    positive: o.positive ?? (dark ? "#53c08a" : "#1e8f5e"),
    negative: o.negative ?? (dark ? "#e0625c" : "#c64440"),
    warn: o.warn ?? (dark ? "#d9a13f" : "#a06c12"),
    info: o.info ?? (dark ? "#6aa7dd" : "#2f6fb4"),
    chart: o.chart ?? [o.accent, "#53c08a", "#e0625c", "#6aa7dd", "#b58ae0"],
    radius: o.radius ?? "14px",
    shadow: o.shadow ?? (dark ? "soft" : "crisp"),
  };
}

const D = true; const L = false;

export const THEMES: ThemeDef[] = [
  { id: "obsidian-gold", name: "Obsidian Gold", dark: D, v: vars(D, { accent: "#e2b357" }) },
  { id: "classic-light", name: "Classic Light", dark: L, v: vars(L, { accent: "#1f6feb", chart: ["#1f6feb", "#1e8f5e", "#c64440", "#7a5af8", "#b45f06"] }) },
  { id: "bento", name: "Bento Grid", dark: L, v: vars(L, { bg: "#eef0f4", surface: "#ffffff", accent: "#e5484d", chart: ["#e5484d", "#12a150", "#006adc", "#8e4ec6", "#ad5700"], radius: "18px" }) },
  { id: "sunset-graphite", name: "Sunset Graphite", dark: D, v: vars(D, { bg: "#131417", accent: "#ff7a45", warn: "#ffb054", chart: ["#ff7a45", "#ffc53d", "#53c08a", "#6aa7dd", "#d64550"] }) },
  { id: "toxic-neon", name: "Toxic Neon", dark: D, v: vars(D, { bg: "#0b0f0c", surface: "#101712", surface2: "#16211a", field: "#0d120e", border: "#1d2b21", borderStrong: "#2c4033", accent: "#7ef04a", chart: ["#7ef04a", "#3ddbb4", "#ffd166", "#5ec8f2", "#c792ea"] }) },
  { id: "midnight-indigo", name: "Midnight Indigo", dark: D, v: vars(D, { bg: "#0c0f20", surface: "#131735", surface2: "#1a1f44", field: "#0e1128", border: "#232a55", borderStrong: "#333c74", accent: "#7c8cff", chart: ["#7c8cff", "#4cc9f0", "#f72585", "#b5e48c", "#ffd166"] }) },
  { id: "arctic-glass", name: "Arctic Glass", dark: L, v: vars(L, { bg: "#eaf2f7", surface: "#f7fbfd", accent: "#0b84a5", info: "#0b84a5", chart: ["#0b84a5", "#3da35d", "#d1495b", "#8f7ae0", "#dd8500"] }) },
  { id: "ocean-slate", name: "Ocean Slate", dark: D, v: vars(D, { bg: "#0f151c", surface: "#151e28", surface2: "#1c2836", field: "#121a23", border: "#24323f", borderStrong: "#35485a", accent: "#38bdf8", chart: ["#38bdf8", "#34d399", "#fb7185", "#fbbf24", "#a78bfa"] }) },
  { id: "emerald-noir", name: "Emerald Noir", dark: D, v: vars(D, { bg: "#0b120f", surface: "#111b16", surface2: "#17251e", field: "#0d1511", border: "#1e2f26", borderStrong: "#2e4538", accent: "#2ee6a8", chart: ["#2ee6a8", "#9ef01a", "#ffd166", "#70d6ff", "#ff70a6"] }) },
  { id: "rosewood", name: "Rosewood", dark: D, v: vars(D, { bg: "#170f12", surface: "#211519", surface2: "#2b1c21", field: "#1b1114", border: "#3a242b", borderStrong: "#503039", accent: "#f2708a", chart: ["#f2708a", "#f9c74f", "#90be6d", "#577590", "#f94144"] }) },
  { id: "solar-sand", name: "Solar Sand", dark: L, v: vars(L, { bg: "#f5efe3", surface: "#fdf9f0", surface2: "#ece3d2", field: "#f9f4e8", border: "#ddd2bc", borderStrong: "#c2b393", accent: "#c05621", text: "#2d2418", muted: "#6f6350", faint: "#94886f", chart: ["#c05621", "#2f855a", "#9b2c2c", "#2b6cb0", "#975a16"] }) },
  { id: "cyber-violet", name: "Cyber Violet", dark: D, v: vars(D, { bg: "#120e1a", surface: "#1a1426", surface2: "#231b33", field: "#160f20", border: "#2c2145", borderStrong: "#3e2f60", accent: "#b794f6", chart: ["#b794f6", "#4fd1c5", "#f687b3", "#f6e05e", "#63b3ed"] }) },
  { id: "nordic-mist", name: "Nordic Mist", dark: L, v: vars(L, { bg: "#f1f4f6", surface: "#fbfcfd", accent: "#31708e", chart: ["#31708e", "#4f9d69", "#b44945", "#8b6fc9", "#c77d1f"] }) },
  { id: "carbon-blue", name: "Carbon Blue", dark: D, v: vars(D, { bg: "#0f1216", surface: "#161b22", surface2: "#1e252e", field: "#12161c", border: "#27303b", borderStrong: "#39434f", accent: "#4f8ff7", chart: ["#4f8ff7", "#3fb68b", "#f2545b", "#f5a524", "#9d7cd8"] }) },
  { id: "copper-night", name: "Copper Night", dark: D, v: vars(D, { bg: "#151010", surface: "#1f1715", surface2: "#291e1b", field: "#191210", border: "#382823", borderStrong: "#4d3730", accent: "#e07b39", chart: ["#e07b39", "#d9a441", "#7fb069", "#6a8caf", "#c65b7c"] }) },
  { id: "lavender-cloud", name: "Lavender Cloud", dark: L, v: vars(L, { bg: "#f4f2fa", surface: "#fdfcff", surface2: "#ece8f7", field: "#f8f6fd", border: "#ddd7ee", borderStrong: "#c0b7de", accent: "#6c5ce7", chart: ["#6c5ce7", "#00b894", "#e17055", "#0984e3", "#fdcb6e"] }) },
  { id: "crimson-steel", name: "Crimson Steel", dark: D, v: vars(D, { bg: "#161214", surface: "#1f191c", surface2: "#292024", field: "#1a1417", border: "#37292f", borderStrong: "#4b3740", accent: "#e5484d", chart: ["#e5484d", "#f5a524", "#46a758", "#52a9ff", "#9a6aff"] }) },
  { id: "monochrome-pro", name: "Monochrome Pro", dark: D, v: vars(D, { bg: "#101012", surface: "#17171a", surface2: "#1f1f23", field: "#131316", border: "#28282d", borderStrong: "#3a3a41", accent: "#d4d4d8", chart: ["#d4d4d8", "#8e8e96", "#5c5c64", "#a1a1aa", "#71717a"] }) },
  { id: "forest-ledger", name: "Forest Ledger", dark: L, v: vars(L, { bg: "#edf1ea", surface: "#f9fbf7", surface2: "#e2e9de", field: "#f3f6f0", border: "#d3dccb", borderStrong: "#b3c1a8", accent: "#3f6b42", chart: ["#3f6b42", "#7a9d54", "#b44945", "#31708e", "#a06c12"] }) },
];

export const THEME_MAP = new Map(THEMES.map((t) => [t.id, t]));

/** Resolve a theme id ("system" included) to its definition. */
export function resolveTheme(id: string): ThemeDef {
  if (id === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? THEME_MAP.get("obsidian-gold")!
      : THEME_MAP.get("classic-light")!;
  }
  return THEME_MAP.get(id) ?? THEME_MAP.get("obsidian-gold")!;
}

/* ---------- variable emission ---------- */

export function buildCssVars(t: ThemeDef): Record<string, string> {
  const v = t.v;
  const accentFg = pickForeground(v.accent);
  const accentSoftFg = ensureContrast(v.accent, v.surface, 4.5);
  const shadowAlpha = t.dark ? "0.5" : "0.12";
  const shadows: Record<ThemeVars["shadow"], [string, string, string]> = {
    soft: [`0 1px 2px rgba(0,0,0,${shadowAlpha})`, `0 4px 14px rgba(0,0,0,${shadowAlpha})`, `0 14px 40px rgba(0,0,0,${shadowAlpha})`],
    crisp: ["0 1px 2px rgba(20,24,32,0.08)", "0 4px 12px rgba(20,24,32,0.10)", "0 16px 44px rgba(20,24,32,0.16)"],
    none: ["none", "none", "none"],
  };
  const [s1, s2, s3] = shadows[v.shadow];
  return {
    "--bg": v.bg, "--surface": v.surface, "--surface2": v.surface2, "--raised": v.raised, "--field": v.field,
    "--border": v.border, "--border-strong": v.borderStrong,
    "--text": v.text, "--muted": v.muted, "--faint": v.faint,
    "--accent": v.accent,
    "--accent-fg": accentFg,
    "--accent-soft-bg": mix(v.accent, v.surface, 0.86),
    "--accent-soft-fg": accentSoftFg,
    "--positive": v.positive, "--negative": v.negative, "--warn": v.warn, "--info": v.info,
    "--chart-1": v.chart[0], "--chart-2": v.chart[1], "--chart-3": v.chart[2], "--chart-4": v.chart[3], "--chart-5": v.chart[4],
    "--radius": v.radius,
    "--shadow-sm": s1, "--shadow-md": s2, "--shadow-lg": s3,
  };
}

export function applyTheme(id: string): void {
  const theme = id === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? THEME_MAP.get("obsidian-gold")! : THEME_MAP.get("classic-light")!)
    : THEME_MAP.get(id) ?? THEME_MAP.get("obsidian-gold")!;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(buildCssVars(theme))) root.style.setProperty(k, v);
  root.style.colorScheme = theme.dark ? "dark" : "light";
  root.style.backgroundColor = theme.v.bg;
}
