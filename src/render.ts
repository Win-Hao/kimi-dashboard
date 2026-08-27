import type { DashboardConfig, SegmentId } from "./config.js";
import type { Lang } from "./lang.js";
import type { ExtraUsage, QuotaData, QuotaRow, StatusLinePayload } from "./types.js";

/** What the status line knows about quota at render time. */
export type QuotaView =
  | { kind: "none" }
  | { kind: "no-auth" }
  | { kind: "expired" }
  | { kind: "data"; stale: boolean; data: QuotaData };

/** 0 = plain text, 16 = basic ANSI, 256 = xterm palette (matches claude-dashboard's tones). */
export type ColorDepth = 0 | 16 | 256;

export interface RenderState {
  payload: StatusLinePayload;
  quota: QuotaView;
  config: DashboardConfig;
  /** Terminal width in cells; used to trim low-priority segments. */
  columns: number;
  colors: ColorDepth;
  /** Unix ms, for time-to-reset countdowns. */
  now: number;
  /** Home directory, so cwd can show as `~`. */
  home?: string;
  /** Unix ms when this kimi-code session was first seen; drives the ⏱ segment. */
  sessionStartedAt?: number;
  /** Language for our own strings; defaults to the SPEC's Chinese wording. */
  lang?: Lang;
}

export const EXPIRED_HINTS: Record<Lang, string> = {
  zh: "额度不可用 · 请在 kimi-code 中继续使用以刷新凭证",
  en: "quota unavailable · keep using kimi-code to refresh the login",
};
export const EXPIRED_HINT = EXPIRED_HINTS.zh;

/** Trim order (SPEC §7): quota first, decoration last. Lower number = kept longer. */
const PRIORITY: Record<SegmentId, number> = { "5h": 1, "7d": 2, ctx: 3, model: 4, tokens: 5, booster: 6, spend: 7, mode: 8, git: 9, cwd: 10, session: 11, version: 12 };
const NARROW_COLUMNS = 60;
const SEPARATOR_WIDTH = 3;
const QUOTA_SEGMENTS: ReadonlySet<SegmentId> = new Set(["5h", "7d"]);

// ---------------------------------------------------------------------------
// colour

type Tone = "green" | "yellow" | "red" | "blue" | "grey" | "pink";
const PALETTE_256: Record<Tone, string> = { green: "38;5;151", yellow: "38;5;222", red: "38;5;210", blue: "38;5;117", grey: "38;5;249", pink: "38;5;218" };
const PALETTE_16: Record<Tone, string> = { green: "32", yellow: "33", red: "31", blue: "34", grey: "90", pink: "35" };

function paint(text: string, tone: Tone, colors: ColorDepth, bold = false): string {
  if (colors === 0) return text;
  const code = (colors === 256 ? PALETTE_256 : PALETTE_16)[tone];
  return `\x1b[${bold ? "1;" : ""}${code}m${text}\x1b[0m`;
}

function dim(text: string, colors: ColorDepth): string {
  return colors === 0 ? text : `\x1b[2m${text}\x1b[0m`;
}

/** Same bands as kimi-code's own context meter so the footer reads as one piece. */
function toneFor(pct: number): Tone {
  return pct > 85 ? "red" : pct >= 60 ? "yellow" : "green";
}

// ---------------------------------------------------------------------------
// width

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** East Asian Wide/Fullwidth plus the default-emoji-presentation symbols we actually use. */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd) ||
    cp === 0x231a || cp === 0x231b || cp === 0x23f0 || cp === 0x23f3 || cp === 0x26a1 || cp === 0x2705 || cp === 0x2728 || cp === 0x274c || cp === 0x2757
  );
}

/** Terminal cells: ANSI sequences are free, wide glyphs cost two. */
export function visibleWidth(text: string): number {
  let width = 0;
  for (const ch of text.replace(ANSI_PATTERN, "")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp === 0xfe0f) continue;
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

// ---------------------------------------------------------------------------
// quota segments

const BAR_FILLED = "█";
const BAR_EMPTY = "░";

function percentOf(row: QuotaRow): number | null {
  if (!(row.limit > 0)) return null;
  return Math.min(100, Math.max(0, Math.round((row.used / row.limit) * 100)));
}

/** Bar plus percentage; a non-positive width drops the bar and keeps the number. */
function meter(pct: number, config: DashboardConfig): string {
  const width = Number.isFinite(config.barWidth) ? Math.floor(config.barWidth) : 0;
  if (width <= 0) return `${pct}%`;
  const filled = Math.min(width, Math.max(0, Math.round((pct / 100) * width)));
  const [on, off] = config.ascii ? ["#", "-"] : [BAR_FILLED, BAR_EMPTY];
  return `${on.repeat(filled)}${off.repeat(width - filled)} ${pct}%`;
}

/** "<1m", "32m", "3h", "3h5m", "2d15h" for a span in ms (negative counts as zero). */
export function formatSpan(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "<1m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days >= 1) return hours ? `${days}d${hours}h` : `${days}d`;
  if (hours >= 1) return mins ? `${hours}h${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** Time until `resetAt`; null when past or unparseable. */
export function untilReset(resetAt: string, now: number): string | null {
  const at = Date.parse(resetAt);
  if (!Number.isFinite(at) || at - now <= 0) return null;
  return formatSpan(at - now);
}

/** The 5h row is the limit whose window is 5 hours; fall back to the first limit. */
function fiveHourRow(data: QuotaData): QuotaRow | null {
  return data.limits.find((row) => row.window?.unit === "hour" && row.window.duration === 5) ?? data.limits[0] ?? null;
}

/** `5h: 18% (32m)` by default; `5h ██░░░░░░░░ 18% (32m)` with quotaStyle = "bar". */
function quotaSegment(label: string, row: QuotaRow | null, state: RenderState): string {
  const pct = row ? percentOf(row) : null;
  const bar = state.config.quotaStyle === "bar";
  if (pct === null) return bar ? `${label} --` : `${label}: --`;
  const value = bar ? meter(pct, state.config) : `${pct}%`;
  let text = `${label}${bar ? "" : ":"} ${paint(value, toneFor(pct), state.colors)}`;
  const reset = state.config.showReset && row?.resetAt ? untilReset(row.resetAt, state.now) : null;
  if (reset) text += ` ${paint(`(${reset})`, "grey", state.colors)}`;
  return text;
}

/**
 * When quota is unavailable as a whole (no auth / expired) the enabled quota
 * segments collapse into one marker, rendered in place of the first of them.
 */
function collapsedQuotaSegment(id: SegmentId, state: RenderState): string | null {
  const enabled = state.config.segments.filter((s) => QUOTA_SEGMENTS.has(s));
  if (enabled[0] !== id) return null;
  switch (state.quota.kind) {
    case "no-auth":
      return `${enabled.join("/")} no auth`;
    case "expired":
      return EXPIRED_HINTS[state.lang ?? "zh"];
    default:
      return null;
  }
}

function quotaSegmentFor(id: "5h" | "7d", state: RenderState): string | null {
  const { quota } = state;
  switch (quota.kind) {
    case "none":
      return state.config.quotaStyle === "bar" ? `${id} --` : `${id}: --`;
    case "data": {
      const row = id === "5h" ? fiveHourRow(quota.data) : quota.data.summary;
      return quotaSegment(quota.stale ? `~${id}` : id, row, state);
    }
    case "no-auth":
    case "expired":
      return collapsedQuotaSegment(id, state);
  }
}

// ---------------------------------------------------------------------------
// decoration segments

const CURRENCY_SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$" };

function money(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  const symbol = CURRENCY_SYMBOLS[currency];
  return symbol ? `${symbol}${amount}` : `${currency} ${amount}`;
}

function icon(glyph: string, state: RenderState): string {
  return state.config.icons && !state.config.ascii ? `${glyph} ` : "";
}

/** The booster segment only exists once the wallet is actually in use (SPEC §7 priority 3). */
function boosterSegment(extra: ExtraUsage | null, state: RenderState): string | null {
  if (!extra) return null;
  if (!extra.monthlyChargeLimitEnabled && extra.balanceCents <= 0) return null;
  return paint(`${icon("⚡", state)}${money(extra.balanceCents, extra.currency)}`, "yellow", state.colors);
}

/** Monthly booster charge used/limit (the closest thing Kimi has to claude-dashboard's `$` cost cell). */
function spendSegment(extra: ExtraUsage | null, state: RenderState): string | null {
  if (!extra || !extra.monthlyChargeLimitEnabled || extra.monthlyChargeLimitCents <= 0) return null;
  const pct = Math.min(100, Math.max(0, Math.round((extra.monthlyUsedCents / extra.monthlyChargeLimitCents) * 100)));
  const text = `${icon("💰", state)}${money(extra.monthlyUsedCents, extra.currency)}/${money(extra.monthlyChargeLimitCents, extra.currency)}`;
  return paint(text, toneFor(pct), state.colors);
}

function sessionSegment(state: RenderState): string | null {
  if (state.sessionStartedAt === undefined) return null;
  return paint(`${icon("⏱", state)}${formatSpan(state.now - state.sessionStartedAt)}`, "grey", state.colors);
}

/** Mirrors kimi-code's own `mode` slot: auto/yolo in warning colour, plan in primary, all bold. */
function modeSegment(payload: StatusLinePayload, state: RenderState): string | null {
  const parts: string[] = [];
  if (payload.permissionMode === "auto" || payload.permissionMode === "yolo") parts.push(paint(payload.permissionMode, "yellow", state.colors, true));
  if (payload.planMode) parts.push(paint("plan", "blue", state.colors, true));
  return parts.length > 0 ? parts.join(" ") : null;
}

function cwdLabel(cwd: string, home: string | undefined): string {
  if (home && (cwd === home || cwd === `${home}/`)) return "~";
  const parts = cwd.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? cwd;
}

/** Context meter, claude-dashboard style: `███░░░░░░░ 32%` (the host's line 2 shows the same number). */
function ctxSegment(payload: StatusLinePayload, state: RenderState): string | null {
  let ratio = payload.contextUsage;
  if (typeof ratio !== "number" && typeof payload.contextTokens === "number" && typeof payload.maxContextTokens === "number" && payload.maxContextTokens > 0) {
    ratio = payload.contextTokens / payload.maxContextTokens;
  }
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return null;
  // Ceil like the host's footer readout, so any non-zero usage shows at least 1% and both lines agree.
  const pct = Math.min(100, Math.max(0, Math.ceil(ratio * 100)));
  return paint(meter(pct, state.config), toneFor(pct), state.colors);
}

/** One decimal, dropping a redundant ".0" — mirrors kimi-code's trimDecimal. */
function trimDecimal(value: number): string {
  const text = value.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

/** kimi-code's own 1024-based formatter (`23.7k`, `977k`, `1.2M`) so line 1 and line 2 never disagree. */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "0";
  if (tokens >= 1024 * 1024) return `${trimDecimal(tokens / (1024 * 1024))}M`;
  if (tokens >= 1024) {
    const k = tokens / 1024;
    return `${k >= 100 ? Math.round(k) : trimDecimal(k)}k`;
  }
  return String(Math.round(tokens));
}

function tokensSegment(payload: StatusLinePayload): string | null {
  const { contextTokens, maxContextTokens } = payload;
  if (typeof contextTokens !== "number" || typeof maxContextTokens !== "number" || !(maxContextTokens > 0) || contextTokens < 0) return null;
  return `${formatTokenCount(contextTokens)}/${formatTokenCount(maxContextTokens)}`;
}

function segmentText(id: SegmentId, state: RenderState): string | null {
  const { payload, colors } = state;
  switch (id) {
    case "5h":
    case "7d":
      return quotaSegmentFor(id, state);
    case "booster":
      return state.quota.kind === "data" ? boosterSegment(state.quota.data.extraUsage, state) : null;
    case "spend":
      return state.quota.kind === "data" ? spendSegment(state.quota.data.extraUsage, state) : null;
    case "session":
      return sessionSegment(state);
    case "version":
      return payload.version ? paint(`v${payload.version.replace(/^v/i, "")}`, "grey", colors) : null;
    case "mode":
      return modeSegment(payload, state);
    case "model":
      return payload.model ? paint(`${icon("◆", state)}${payload.model}`, "blue", colors) : null;
    case "git":
      return payload.gitBranch ? paint(`${icon("🌿", state)}${payload.gitBranch}`, "pink", colors) : null;
    case "cwd":
      return payload.cwd ? paint(`${icon("📁", state)}${cwdLabel(payload.cwd, state.home)}`, "yellow", colors) : null;
    case "ctx":
      return ctxSegment(payload, state);
    case "tokens":
      return tokensSegment(payload);
  }
}

// ---------------------------------------------------------------------------
// layout

function separator(state: RenderState): string {
  const { config, colors } = state;
  if (config.ascii) return " | ";
  switch (config.separator) {
    case "space":
      return "   ";
    case "dot":
      return ` ${dim("·", colors)} `;
    case "arrow":
      return ` ${dim("›", colors)} `;
    case "pipe":
      return ` ${dim("│", colors)} `;
  }
}

interface Segment {
  id: SegmentId;
  text: string;
}

function joinWidth(segments: Segment[]): number {
  return segments.reduce((sum, seg, i) => sum + visibleWidth(seg.text) + (i > 0 ? SEPARATOR_WIDTH : 0), 0);
}

/** Drop lowest-priority segments until the line fits; narrow terminals keep only priority 1. */
function fit(segments: Segment[], columns: number): Segment[] {
  let kept = columns < NARROW_COLUMNS ? segments.filter((s) => PRIORITY[s.id] === 1) : segments;
  while (kept.length > 0 && joinWidth(kept) > columns) {
    const lowest = kept.reduce((a, b) => (PRIORITY[b.id] >= PRIORITY[a.id] ? b : a));
    kept = kept.filter((s) => s !== lowest);
  }
  return kept;
}

/** Pure: (state) => one line. Never throws on odd input; the caller still wraps it. */
export function render(state: RenderState): string {
  const segments: Segment[] = [];
  for (const id of state.config.segments) {
    const text = segmentText(id, state);
    if (text !== null) segments.push({ id, text });
  }
  return fit(segments, state.columns)
    .map((s) => s.text)
    .join(separator(state));
}
