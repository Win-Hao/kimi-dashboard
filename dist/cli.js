#!/usr/bin/env node

// src/cli.ts
import { spawn } from "child_process";
import { readFileSync as readFileSync8 } from "fs";
import { homedir } from "os";
import { fileURLToPath } from "url";

// src/config.ts
import { readFileSync } from "fs";
import { join } from "path";

// src/toml.ts
function parseToml(text) {
  const doc = { root: {}, sections: [] };
  let current = doc.root;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line2 = (lines[i] ?? "").trim();
    if (line2.length === 0 || line2.startsWith("#")) continue;
    if (line2.startsWith("[")) {
      if (line2.startsWith("[[")) {
        current = {};
        continue;
      }
      const path = parseHeader(line2);
      if (path === null) continue;
      const section = { path, table: {} };
      doc.sections.push(section);
      current = section.table;
      continue;
    }
    const eq = line2.indexOf("=");
    if (eq <= 0) continue;
    const key = unquoteKey(line2.slice(0, eq).trim());
    let raw = line2.slice(eq + 1);
    if (stripComment(raw).trim().startsWith("[") && !stripComment(raw).trim().endsWith("]")) {
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const next = stripComment(lines[j] ?? "").trim();
        if (/^(\[|[A-Za-z0-9_"'.-]+\s*=)/.test(next)) break;
        raw += ` ${next}`;
        if (next.endsWith("]")) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) continue;
      i = j;
    }
    const value = parseTomlValue(raw);
    if (value !== void 0) current[key] = value;
  }
  return doc;
}
function findSection(doc, path) {
  return doc.sections.find((s) => s.path.length === path.length && s.path.every((p, i) => p === path[i]))?.table;
}
function parseHeader(line2) {
  const body = stripComment(line2).trim();
  if (!body.startsWith("[") || !body.endsWith("]")) return null;
  const inner = body.slice(1, -1);
  const parts = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] ?? "";
    if (quote) {
      if (ch === "\\" && quote === '"') current += inner[++i] ?? "";
      else if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ".") {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  parts.push(current.trim());
  if (quote !== null || parts.some((p) => p.length === 0)) return null;
  return parts;
}
function unquoteKey(key) {
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(key) ?? /^'([^']*)'$/.exec(key);
  return quoted ? quoted[1] ?? "" : key;
}
function parseTomlValue(raw) {
  const value = stripComment(raw).trim();
  if (value === "true") return true;
  if (value === "false") return false;
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(value) ?? /^'([^']*)'$/.exec(value);
  if (quoted) return (quoted[1] ?? "").replace(/\\(["\\])/g, "$1");
  if (value.startsWith("[") && value.endsWith("]")) {
    const items = [];
    for (const part of splitTopLevel(value.slice(1, -1))) {
      const item = part.trim();
      if (item.length === 0) continue;
      const str = parseTomlValue(item);
      if (typeof str !== "string") return void 0;
      items.push(str);
    }
    return items;
  }
  if (/^[+-]?(\d[\d_]*)(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    const n = Number(value.replace(/_/g, ""));
    return Number.isFinite(n) ? n : void 0;
  }
  return void 0;
}
function stripComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return raw.slice(0, i);
  }
  return raw;
}
function splitTopLevel(inner) {
  const parts = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] ?? "";
    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"') current += inner[++i] ?? "";
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

// src/config.ts
var SEGMENT_IDS = ["5h", "7d", "booster", "spend", "mode", "model", "git", "cwd", "ctx", "tokens", "session", "version"];
var DEFAULT_CONFIG = Object.freeze({
  segments: ["model", "ctx", "tokens", "5h", "7d", "booster", "spend", "mode", "git", "cwd", "session", "version"],
  refreshIntervalMs: 12e4,
  staleAfterMs: 6e5,
  ascii: false,
  barWidth: 10,
  quotaWhenNotKimi: "hide",
  separator: "pipe",
  showReset: true,
  icons: true,
  quotaStyle: "text",
  lang: "auto"
});
function configPath(env, home) {
  const base = env["XDG_CONFIG_HOME"]?.trim();
  return join(base && base.length > 0 ? base : join(home, ".config"), "kimi-dashboard", "config.toml");
}
function loadConfig(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  return { ...DEFAULT_CONFIG, ...parseConfigToml(text) };
}
function parseConfigToml(text) {
  const out = {};
  for (const [key, value] of Object.entries(parseToml(text).root)) applyKey(out, key, value);
  return out;
}
function applyKey(out, key, value) {
  switch (key) {
    case "segments": {
      if (!Array.isArray(value)) return;
      const known = new Set(SEGMENT_IDS);
      const segments = value.filter((v) => known.has(v));
      if (segments.length > 0) out.segments = segments;
      return;
    }
    case "refreshIntervalMs":
    case "staleAfterMs":
    case "barWidth": {
      if (typeof value !== "number" || value <= 0) return;
      out[key] = Math.floor(value);
      return;
    }
    case "ascii":
    case "showReset":
    case "icons":
      if (typeof value === "boolean") out[key] = value;
      return;
    case "separator":
      if (value === "pipe" || value === "space" || value === "dot" || value === "arrow") out.separator = value;
      return;
    case "quotaStyle":
      if (value === "text" || value === "bar") out.quotaStyle = value;
      return;
    case "lang":
      if (value === "auto" || value === "zh" || value === "en") out.lang = value;
      return;
    case "quotaWhenNotKimi":
      if (value === "hide" || value === "show") out.quotaWhenNotKimi = value;
      return;
    default:
      return;
  }
}

// src/configure.ts
import { mkdirSync as mkdirSync4, existsSync as existsSync2, readFileSync as readFileSync4, writeFileSync as writeFileSync4 } from "fs";
import { dirname as dirname4 } from "path";

// src/preview.ts
import { join as join6 } from "path";

// src/render.ts
var EXPIRED_HINTS = {
  zh: "\u989D\u5EA6\u4E0D\u53EF\u7528 \xB7 \u8BF7\u5728 kimi-code \u4E2D\u7EE7\u7EED\u4F7F\u7528\u4EE5\u5237\u65B0\u51ED\u8BC1",
  en: "quota unavailable \xB7 keep using kimi-code to refresh the login"
};
var EXPIRED_HINT = EXPIRED_HINTS.zh;
var PRIORITY = { "5h": 1, "7d": 2, ctx: 3, model: 4, tokens: 5, booster: 6, spend: 7, mode: 8, git: 9, cwd: 10, session: 11, version: 12 };
var NARROW_COLUMNS = 60;
var SEPARATOR_WIDTH = 3;
var QUOTA_SEGMENTS = /* @__PURE__ */ new Set(["5h", "7d"]);
var PALETTE_256 = { green: "38;5;151", yellow: "38;5;222", red: "38;5;210", blue: "38;5;117", grey: "38;5;249", pink: "38;5;218" };
var PALETTE_16 = { green: "32", yellow: "33", red: "31", blue: "34", grey: "90", pink: "35" };
function paint(text, tone, colors, bold = false) {
  if (colors === 0) return text;
  const code = (colors === 256 ? PALETTE_256 : PALETTE_16)[tone];
  return `\x1B[${bold ? "1;" : ""}${code}m${text}\x1B[0m`;
}
function dim(text, colors) {
  return colors === 0 ? text : `\x1B[2m${text}\x1B[0m`;
}
function toneFor(pct) {
  return pct > 85 ? "red" : pct >= 60 ? "yellow" : "green";
}
var ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
function isWide(cp) {
  return cp >= 4352 && cp <= 4447 || cp >= 11904 && cp <= 42191 && cp !== 12351 || cp >= 44032 && cp <= 55203 || cp >= 63744 && cp <= 64255 || cp >= 65072 && cp <= 65103 || cp >= 65280 && cp <= 65376 || cp >= 65504 && cp <= 65510 || cp >= 127744 && cp <= 129791 || cp >= 131072 && cp <= 262141 || cp === 8986 || cp === 8987 || cp === 9200 || cp === 9203 || cp === 9889 || cp === 9989 || cp === 10024 || cp === 10060 || cp === 10071;
}
function visibleWidth(text) {
  let width = 0;
  for (const ch of text.replace(ANSI_PATTERN, "")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 32 || cp >= 127 && cp < 160 || cp === 65039) continue;
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}
var BAR_FILLED = "\u2588";
var BAR_EMPTY = "\u2591";
function percentOf(row) {
  if (!(row.limit > 0)) return null;
  return Math.min(100, Math.max(0, Math.round(row.used / row.limit * 100)));
}
function meter(pct, config) {
  const width = Number.isFinite(config.barWidth) ? Math.floor(config.barWidth) : 0;
  if (width <= 0) return `${pct}%`;
  const filled = Math.min(width, Math.max(0, Math.round(pct / 100 * width)));
  const [on, off] = config.ascii ? ["#", "-"] : [BAR_FILLED, BAR_EMPTY];
  return `${on.repeat(filled)}${off.repeat(width - filled)} ${pct}%`;
}
function formatSpan(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 6e4);
  if (minutes < 1) return "<1m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const mins = minutes % 60;
  if (days >= 1) return hours ? `${days}d${hours}h` : `${days}d`;
  if (hours >= 1) return mins ? `${hours}h${mins}m` : `${hours}h`;
  return `${mins}m`;
}
function untilReset(resetAt, now) {
  const at = Date.parse(resetAt);
  if (!Number.isFinite(at) || at - now <= 0) return null;
  return formatSpan(at - now);
}
function fiveHourRow(data) {
  return data.limits.find((row) => row.window?.unit === "hour" && row.window.duration === 5) ?? data.limits[0] ?? null;
}
function quotaSegment(label, row, state) {
  const pct = row ? percentOf(row) : null;
  const bar = state.config.quotaStyle === "bar";
  if (pct === null) return bar ? `${label} --` : `${label}: --`;
  const value = bar ? meter(pct, state.config) : `${pct}%`;
  let text = `${label}${bar ? "" : ":"} ${paint(value, toneFor(pct), state.colors)}`;
  const reset = state.config.showReset && row?.resetAt ? untilReset(row.resetAt, state.now) : null;
  if (reset) text += ` ${paint(`(${reset})`, "grey", state.colors)}`;
  return text;
}
function collapsedQuotaSegment(id, state) {
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
function quotaSegmentFor(id, state) {
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
var CURRENCY_SYMBOLS = { CNY: "\xA5", USD: "$" };
function money(cents, currency) {
  const amount = (cents / 100).toFixed(2);
  const symbol = CURRENCY_SYMBOLS[currency];
  return symbol ? `${symbol}${amount}` : `${currency} ${amount}`;
}
function icon(glyph, state) {
  return state.config.icons && !state.config.ascii ? `${glyph} ` : "";
}
function boosterSegment(extra, state) {
  if (!extra) return null;
  if (!extra.monthlyChargeLimitEnabled && extra.balanceCents <= 0) return null;
  return paint(`${icon("\u26A1", state)}${money(extra.balanceCents, extra.currency)}`, "yellow", state.colors);
}
function spendSegment(extra, state) {
  if (!extra || !extra.monthlyChargeLimitEnabled || extra.monthlyChargeLimitCents <= 0) return null;
  const pct = Math.min(100, Math.max(0, Math.round(extra.monthlyUsedCents / extra.monthlyChargeLimitCents * 100)));
  const text = `${icon("\u{1F4B0}", state)}${money(extra.monthlyUsedCents, extra.currency)}/${money(extra.monthlyChargeLimitCents, extra.currency)}`;
  return paint(text, toneFor(pct), state.colors);
}
function sessionSegment(state) {
  if (state.sessionStartedAt === void 0) return null;
  return paint(`${icon("\u23F1", state)}${formatSpan(state.now - state.sessionStartedAt)}`, "grey", state.colors);
}
function modeSegment(payload, state) {
  const parts = [];
  if (payload.permissionMode === "auto" || payload.permissionMode === "yolo") parts.push(paint(payload.permissionMode, "yellow", state.colors, true));
  if (payload.planMode) parts.push(paint("plan", "blue", state.colors, true));
  return parts.length > 0 ? parts.join(" ") : null;
}
function cwdLabel(cwd, home) {
  if (home && (cwd === home || cwd === `${home}/`)) return "~";
  const parts = cwd.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? cwd;
}
function ctxSegment(payload, state) {
  let ratio = payload.contextUsage;
  if (typeof ratio !== "number" && typeof payload.contextTokens === "number" && typeof payload.maxContextTokens === "number" && payload.maxContextTokens > 0) {
    ratio = payload.contextTokens / payload.maxContextTokens;
  }
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return null;
  const pct = Math.min(100, Math.max(0, Math.ceil(ratio * 100)));
  return paint(meter(pct, state.config), toneFor(pct), state.colors);
}
function trimDecimal(value) {
  const text = value.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}
function formatTokenCount(tokens) {
  if (!Number.isFinite(tokens) || tokens < 0) return "0";
  if (tokens >= 1024 * 1024) return `${trimDecimal(tokens / (1024 * 1024))}M`;
  if (tokens >= 1024) {
    const k = tokens / 1024;
    return `${k >= 100 ? Math.round(k) : trimDecimal(k)}k`;
  }
  return String(Math.round(tokens));
}
function tokensSegment(payload) {
  const { contextTokens, maxContextTokens } = payload;
  if (typeof contextTokens !== "number" || typeof maxContextTokens !== "number" || !(maxContextTokens > 0) || contextTokens < 0) return null;
  return `${formatTokenCount(contextTokens)}/${formatTokenCount(maxContextTokens)}`;
}
function segmentText(id, state) {
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
      return payload.model ? paint(`${icon("\u25C6", state)}${payload.model}`, "blue", colors) : null;
    case "git":
      return payload.gitBranch ? paint(`${icon("\u{1F33F}", state)}${payload.gitBranch}`, "pink", colors) : null;
    case "cwd":
      return payload.cwd ? paint(`${icon("\u{1F4C1}", state)}${cwdLabel(payload.cwd, state.home)}`, "yellow", colors) : null;
    case "ctx":
      return ctxSegment(payload, state);
    case "tokens":
      return tokensSegment(payload);
  }
}
function separator(state) {
  const { config, colors } = state;
  if (config.ascii) return " | ";
  switch (config.separator) {
    case "space":
      return "   ";
    case "dot":
      return ` ${dim("\xB7", colors)} `;
    case "arrow":
      return ` ${dim("\u203A", colors)} `;
    case "pipe":
      return ` ${dim("\u2502", colors)} `;
  }
}
function joinWidth(segments) {
  return segments.reduce((sum, seg, i) => sum + visibleWidth(seg.text) + (i > 0 ? SEPARATOR_WIDTH : 0), 0);
}
function fit(segments, columns) {
  let kept = columns < NARROW_COLUMNS ? segments.filter((s) => PRIORITY[s.id] === 1) : segments;
  while (kept.length > 0 && joinWidth(kept) > columns) {
    const lowest = kept.reduce((a, b) => PRIORITY[b.id] >= PRIORITY[a.id] ? b : a);
    kept = kept.filter((s) => s !== lowest);
  }
  return kept;
}
function render(state) {
  const segments = [];
  for (const id of state.config.segments) {
    const text = segmentText(id, state);
    if (text !== null) segments.push({ id, text });
  }
  return fit(segments, state.columns).map((s) => s.text).join(separator(state));
}

// src/lang.ts
function detectLang(setting, env) {
  if (setting === "zh" || setting === "en") return setting;
  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = env[key]?.trim();
    if (!value) continue;
    return value.toLowerCase().startsWith("zh") ? "zh" : "en";
  }
  return "en";
}

// src/statusline.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync3 } from "fs";
import { dirname as dirname3, join as join5 } from "path";

// src/paths.ts
import { existsSync } from "fs";
import { delimiter, join as join2 } from "path";
var DEFAULT_BASE_URL = "https://api.kimi.com/coding/v1";
function kimiHome(env, home) {
  const override = env["KIMI_CODE_HOME"]?.trim();
  return override && override.length > 0 ? override : join2(home, ".kimi-code");
}
function apiBaseUrl(env) {
  const override = env["KIMI_CODE_BASE_URL"]?.trim();
  return (override && override.length > 0 ? override : DEFAULT_BASE_URL).replace(/\/+$/, "");
}
function findOnPath(env, name) {
  const candidates = process.platform === "win32" ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const dir of (env["PATH"] ?? "").split(delimiter)) {
    if (dir.length === 0) continue;
    for (const candidate of candidates) {
      const full = join2(dir, candidate);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

// src/provider.ts
var MANAGED_KIMI_PREFIX = "managed:kimi-code";
function modelProviderKind(configText, modelLabel) {
  if (modelLabel.length === 0) return "unknown";
  const doc = parseToml(configText);
  const model = doc.sections.find(
    (s) => s.path.length === 2 && s.path[0] === "models" && (s.table["display_name"] === modelLabel || s.path[1] === modelLabel)
  );
  if (!model) return "unknown";
  const providerName = model.table["provider"];
  if (typeof providerName !== "string") return "unknown";
  const provider = findSection(doc, ["providers", providerName]);
  if (provider?.["type"] === "kimi") return "kimi";
  if (provider === void 0 && providerName.startsWith(MANAGED_KIMI_PREFIX)) return "kimi";
  return "other";
}

// src/quota/cache.ts
import { mkdirSync, readFileSync as readFileSync2, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join as join3 } from "path";
var CACHE_SCHEMA_VERSION = 1;
function cacheDir(env, home) {
  const base = env["XDG_CACHE_HOME"]?.trim();
  return join3(base && base.length > 0 ? base : join3(home, ".cache"), "kimi-dashboard");
}
function cachePath(env, home) {
  return join3(cacheDir(env, home), "quota.json");
}
function readCache(path) {
  let raw;
  try {
    raw = readFileSync2(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const cache = parsed;
    if (cache.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    return cache;
  } catch {
    return null;
  }
}
function writeCache(path, cache) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(16).slice(2, 8)}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(cache)}
`, { encoding: "utf8", mode: 384 });
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
    }
    throw error;
  }
}

// src/quota/lock.ts
import { mkdirSync as mkdirSync2, statSync, unlinkSync as unlinkSync2, utimesSync, writeFileSync as writeFileSync2 } from "fs";
import { dirname as dirname2, join as join4 } from "path";
var LOCK_STALE_MS = 3e4;
function lockPath(env, home) {
  return join4(cacheDir(env, home), "refresh.lock");
}
function isLockFresh(path, staleMs = LOCK_STALE_MS) {
  try {
    return Date.now() - statSync(path).mtimeMs < staleMs;
  } catch {
    return false;
  }
}
function acquireLock(path, staleMs = LOCK_STALE_MS) {
  try {
    mkdirSync2(dirname2(path), { recursive: true });
    writeFileSync2(path, `${process.pid}
`, { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") return false;
  }
  if (isLockFresh(path, staleMs)) return false;
  try {
    writeFileSync2(path, `${process.pid}
`);
    const now = /* @__PURE__ */ new Date();
    utimesSync(path, now, now);
    return true;
  } catch {
    return false;
  }
}
function releaseLock(path) {
  try {
    unlinkSync2(path);
  } catch {
  }
}

// src/statusline.ts
var DEFAULT_COLUMNS = 120;
function statusline(input) {
  try {
    return run(input);
  } catch {
    return "";
  }
}
var QUOTA_SEGMENTS2 = /* @__PURE__ */ new Set(["5h", "7d", "booster", "spend"]);
var MAX_TRACKED_SESSIONS = 50;
function sessionsPath(env, home) {
  return join5(cacheDir(env, home), "sessions.json");
}
function sessionStartedAt(env, home, sessionId, now) {
  if (!sessionId) return void 0;
  const path = sessionsPath(env, home);
  let store = {};
  try {
    const parsed = JSON.parse(readFileSync3(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) store = parsed;
  } catch {
  }
  const known = store[sessionId];
  if (typeof known === "number" && Number.isFinite(known)) return known;
  const kept = Object.entries(store).filter((entry) => typeof entry[1] === "number").sort((a, b) => b[1] - a[1]).slice(0, MAX_TRACKED_SESSIONS - 1);
  try {
    mkdirSync3(dirname3(path), { recursive: true });
    writeFileSync3(path, `${JSON.stringify(Object.fromEntries([[sessionId, now], ...kept]))}
`);
  } catch {
  }
  return now;
}
function hideQuota(config, model, env, home) {
  if (config.quotaWhenNotKimi !== "hide" || !model) return false;
  let text;
  try {
    text = readFileSync3(join5(kimiHome(env, home), "config.toml"), "utf8");
  } catch {
    return false;
  }
  return modelProviderKind(text, model) === "other";
}
function payloadKeysPath(env, home) {
  return join5(cacheDir(env, home), "payload-keys.json");
}
function recordPayloadKeys(env, home, keys) {
  const path = payloadKeysPath(env, home);
  const next = JSON.stringify(keys);
  try {
    if (readFileSync3(path, "utf8").trim() === next) return;
  } catch {
  }
  try {
    mkdirSync3(dirname3(path), { recursive: true });
    writeFileSync3(path, `${next}
`);
  } catch {
  }
}
function run(input) {
  const parsed = parsePayload(input.stdin);
  if (parsed === null) return "";
  const { payload, keys } = parsed;
  const { env, home } = input;
  recordPayloadKeys(env, home, keys);
  const now = input.now ?? Date.now();
  const loaded = input.config ?? loadConfig(configPath(env, home));
  const config = hideQuota(loaded, payload.model, env, home) ? { ...loaded, segments: loaded.segments.filter((s) => !QUOTA_SEGMENTS2.has(s)) } : loaded;
  const showsQuota = config.segments.some((s) => QUOTA_SEGMENTS2.has(s));
  const cache = readCache(cachePath(env, home));
  if (showsQuota && shouldRefresh(cache, now, config) && !isLockFresh(lockPath(env, home))) input.spawnRefresh();
  const colors = colorDepth(env);
  const startedAt = config.segments.includes("session") ? sessionStartedAt(env, home, payload.sessionId, now) : void 0;
  return render({
    payload,
    quota: quotaView(cache, now, config),
    config: colors === 0 ? { ...config, ascii: true } : config,
    columns: columnsFrom(env),
    colors,
    now,
    home,
    lang: detectLang(config.lang, env),
    ...startedAt !== void 0 ? { sessionStartedAt: startedAt } : {}
  });
}
function parsePayload(stdin) {
  let raw;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw;
  const payload = {};
  const str = (key) => {
    const v = rec[key];
    if (typeof v === "string") payload[key] = v;
  };
  const num = (key) => {
    const v = rec[key];
    if (typeof v === "number" && Number.isFinite(v)) payload[key] = v;
  };
  str("model");
  str("cwd");
  str("permissionMode");
  str("sessionId");
  str("version");
  num("contextUsage");
  num("contextTokens");
  num("maxContextTokens");
  if (typeof rec["gitBranch"] === "string" || rec["gitBranch"] === null) payload.gitBranch = rec["gitBranch"];
  if (typeof rec["planMode"] === "boolean") payload.planMode = rec["planMode"];
  return { payload, keys: Object.keys(rec) };
}
function hasData(cache) {
  return cache.summary !== null || cache.limits.length > 0;
}
function quotaView(cache, now, config) {
  if (cache === null) return { kind: "none" };
  if (cache.errorCode === "no-auth" || cache.errorCode === "invalid-credential") return { kind: "no-auth" };
  if (hasData(cache)) return { kind: "data", stale: now - cache.fetchedAt > config.staleAfterMs, data: cache };
  if (cache.errorCode === "expired") return { kind: "expired" };
  return { kind: "none" };
}
function shouldRefresh(cache, now, config) {
  if (cache === null) return true;
  return now - cache.attemptedAt >= config.refreshIntervalMs;
}
function colorDepth(env) {
  const noColor = env["NO_COLOR"];
  const term = env["TERM"] ?? "";
  if (noColor !== void 0 && noColor !== "" || term === "dumb") return 0;
  const colorterm = env["COLORTERM"] ?? "";
  if (colorterm === "truecolor" || colorterm === "24bit" || term.includes("256color")) return 256;
  return 16;
}
function columnsFrom(env) {
  const n = Number.parseInt(env["COLUMNS"] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COLUMNS;
}

// src/preview.ts
function sampleQuota(now, hot = false) {
  const minutes = 6e4;
  return {
    summary: { name: "weekly", window: { duration: 1, unit: "week" }, used: hot ? 920 : 340, limit: 1e3, resetAt: new Date(now + (44 * 60 + 30) * minutes).toISOString() },
    limits: [{ name: "5h", window: { duration: 5, unit: "hour" }, used: hot ? 85 : 18, limit: 100, resetAt: new Date(now + 32.5 * minutes).toISOString() }],
    extraUsage: { balanceCents: 4200, totalCents: 1e4, monthlyChargeLimitEnabled: true, monthlyChargeLimitCents: 2e4, monthlyUsedCents: hot ? 17500 : 5800, currency: "CNY" }
  };
}
function flagValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return void 0;
  return args[index + 1];
}
function previewLine(config, ctx, opts) {
  const now = Date.now();
  const hot = opts.hot === true;
  const contextTokens = hot ? 176e3 : 64e3;
  return render({
    payload: {
      model: opts.notKimi ? "DeepSeek V4 Flash" : "kimi-k2",
      cwd: join6(ctx.home, "projects", "demo"),
      gitBranch: "main",
      permissionMode: "auto",
      contextUsage: contextTokens / 2e5,
      contextTokens,
      maxContextTokens: 2e5,
      sessionId: "session_demo",
      version: "0.39.0"
    },
    quota: opts.quota ?? { kind: "data", stale: false, data: sampleQuota(now, hot) },
    config,
    columns: opts.columns,
    colors: opts.colors,
    now,
    home: ctx.home,
    lang: detectLang(config.lang, ctx.env),
    sessionStartedAt: now - 65 * 6e4
  });
}
function runPreview(args, ctx) {
  const base = loadConfig(configPath(ctx.env, ctx.home));
  const notKimi = args.includes("--not-kimi");
  let segments = args.includes("--ctx") && !base.segments.includes("ctx") ? [...base.segments, "ctx"] : base.segments;
  if (notKimi) segments = segments.filter((s) => s !== "5h" && s !== "7d" && s !== "booster" && s !== "spend");
  const config = { ...DEFAULT_CONFIG, ...base, segments, ascii: base.ascii || args.includes("--ascii"), quotaStyle: args.includes("--bar") ? "bar" : base.quotaStyle };
  const hot = args.includes("--hot");
  let quota;
  if (args.includes("--no-auth")) quota = { kind: "no-auth" };
  else if (args.includes("--expired")) quota = { kind: "expired" };
  else if (args.includes("--empty")) quota = { kind: "none" };
  else if (args.includes("--stale")) quota = { kind: "data", stale: true, data: sampleQuota(Date.now(), hot) };
  const width = Number.parseInt(flagValue(args, "--width") ?? "", 10);
  const colors = args.includes("--no-color") || !process.stdout.isTTY && !args.includes("--color") ? 0 : colorDepth(ctx.env);
  const line2 = previewLine(colors === 0 ? { ...config, ascii: true } : config, ctx, {
    colors,
    columns: Number.isFinite(width) && width > 0 ? width : process.stdout.columns ?? columnsFrom(ctx.env),
    hot,
    notKimi,
    ...quota ? { quota } : {}
  });
  process.stdout.write(`${line2}
`);
  return 0;
}

// src/configure.ts
var SEGMENT_ORDER = DEFAULT_CONFIG.segments;
var PRESETS = {
  compact: ["model", "ctx", "tokens", "5h", "7d"],
  full: [...DEFAULT_CONFIG.segments],
  quota: ["5h", "7d", "booster", "spend", "mode", "git"]
};
var KEYS = ["segments", "quotaStyle", "separator", "showReset", "icons", "barWidth", "ascii", "quotaWhenNotKimi", "refreshIntervalMs", "staleAfterMs", "lang"];
var ENUMS = {
  quotaStyle: ["text", "bar"],
  separator: ["pipe", "dot", "arrow", "space"],
  quotaWhenNotKimi: ["hide", "show"],
  lang: ["auto", "zh", "en"]
};
function applyAssignments(base, assignments) {
  const next = { ...base, segments: [...base.segments] };
  for (const raw of assignments) {
    const eq = raw.indexOf("=");
    if (eq <= 0) return { ok: false, error: `expected key=value (got "${raw}")` };
    const key = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (!KEYS.includes(key)) return { ok: false, error: `unknown key "${key}" (available: ${KEYS.join(" ")})` };
    switch (key) {
      case "segments": {
        const ids = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
        const known = new Set(SEGMENT_ORDER);
        for (const id of ids) if (!known.has(id)) return { ok: false, error: `unknown segment "${id}" (available: ${SEGMENT_ORDER.join(" ")})` };
        if (ids.length === 0) return { ok: false, error: "segments must list at least one segment" };
        next.segments = ids;
        break;
      }
      case "quotaStyle":
      case "separator":
      case "quotaWhenNotKimi":
      case "lang": {
        const allowed = ENUMS[key] ?? [];
        if (!allowed.includes(value)) return { ok: false, error: `${key} must be one of: ${allowed.join(", ")} (got "${value}")` };
        next[key] = value;
        break;
      }
      case "showReset":
      case "icons":
      case "ascii": {
        if (value !== "true" && value !== "false") return { ok: false, error: `${key} must be true or false (got "${value}")` };
        next[key] = value === "true";
        break;
      }
      case "barWidth":
      case "refreshIntervalMs":
      case "staleAfterMs": {
        const n = Number(value);
        if (!/^\d+$/.test(value) || !(n > 0)) return { ok: false, error: `${key} must be a positive integer (got "${value}")` };
        next[key] = n;
        break;
      }
    }
  }
  return { ok: true, config: next };
}
function line(key, value, comment) {
  const head = `${key} = ${value}`;
  return comment ? `${head.padEnd(31)}# ${comment}` : head;
}
function serializeConfig(config) {
  return [
    "# kimi-dashboard \u2014 \u5E95\u680F\u914D\u7F6E / footer configuration",
    `# \u53EF\u7528\u6BB5\u4F4D / segments: ${SEGMENT_ORDER.join(" ")}`,
    line("segments", `[${config.segments.map((id) => JSON.stringify(id)).join(", ")}]`),
    line("quotaStyle", JSON.stringify(config.quotaStyle), "text | bar"),
    line("separator", JSON.stringify(config.separator), "pipe | dot | arrow | space"),
    line("showReset", String(config.showReset), "(32m) \u91CD\u7F6E\u5012\u8BA1\u65F6 / reset countdown"),
    line("icons", String(config.icons), "\u25C6 \u{1F33F} \u{1F4C1} \u26A1 \u{1F4B0} \u23F1"),
    line("barWidth", String(config.barWidth)),
    line("ascii", String(config.ascii)),
    line("quotaWhenNotKimi", JSON.stringify(config.quotaWhenNotKimi), "hide | show"),
    line("refreshIntervalMs", String(config.refreshIntervalMs)),
    line("staleAfterMs", String(config.staleAfterMs)),
    line("lang", JSON.stringify(config.lang), "auto | zh | en \u2014 footer hint language (auto = $LANG)"),
    ""
  ].join("\n");
}
var PRESET_NAMES = Object.keys(PRESETS).join(", ");
var isPreset = (s) => Object.prototype.hasOwnProperty.call(PRESETS, s);
function splitArgs(args) {
  let preset;
  const assignments = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--preset") {
      const value = args[++i];
      if (value === void 0) return { ok: false, error: `--preset needs a value (${PRESET_NAMES})` };
      if (!isPreset(value)) return { ok: false, error: `unknown preset "${value}" (available: ${PRESET_NAMES})` };
      preset = value;
    } else if (arg.includes("=")) {
      assignments.push(arg);
    } else if (isPreset(arg)) {
      preset = arg;
    } else {
      return { ok: false, error: `expected a preset (${PRESET_NAMES}) or key=value (got "${arg}")` };
    }
  }
  return { ok: true, preset, assignments };
}
function runConfig(args, ctx) {
  const path = configPath(ctx.env, ctx.home);
  const current = loadConfig(path);
  const split = splitArgs(args);
  if (!split.ok) {
    process.stderr.write(`${split.error}
`);
    return 1;
  }
  const { preset, assignments } = split;
  let next = preset === void 0 ? current : { ...current, segments: [...PRESETS[preset]] };
  const applied = applyAssignments(next, assignments);
  if (!applied.ok) {
    process.stderr.write(`${applied.error}
`);
    return 1;
  }
  next = applied.config;
  const changed = preset !== void 0 || assignments.length > 0;
  const text = serializeConfig(next);
  if (changed) {
    mkdirSync4(dirname4(path), { recursive: true });
    writeFileSync4(path, text, "utf8");
    process.stdout.write(`wrote ${path}
`);
  } else {
    process.stdout.write(`${path}${existsSync2(path) ? "" : " (absent, using defaults)"}
`);
  }
  process.stdout.write(text);
  const colors = process.stdout.isTTY ? colorDepth(ctx.env) : 0;
  process.stdout.write(`preview: ${previewLine(colors === 0 ? { ...next, ascii: true } : next, ctx, { colors, columns: columnsFrom(ctx.env) })}
`);
  return 0;
}

// src/quota/creds.ts
import { createHash } from "crypto";
import { readFileSync as readFileSync5 } from "fs";
import { join as join7 } from "path";
var EXPIRY_MARGIN_SECONDS = 60;
var DEFAULT_CREDENTIAL_NAME = "kimi-code";
var DEFAULT_OAUTH_HOST = "https://auth.kimi.com";
var SCOPED_PREFIX = "kimi-code-env-";
function normalizeEndpoint(value) {
  return value.trim().replace(/\/+$/, "");
}
function credentialName(env) {
  const oauthHost = normalizeEndpoint(env["KIMI_CODE_OAUTH_HOST"] ?? env["KIMI_OAUTH_HOST"] ?? DEFAULT_OAUTH_HOST);
  const baseUrl = apiBaseUrl(env);
  if (oauthHost === DEFAULT_OAUTH_HOST && baseUrl === DEFAULT_BASE_URL) return DEFAULT_CREDENTIAL_NAME;
  const digest = createHash("sha256").update(JSON.stringify({ oauthHost, baseUrl })).digest("hex").slice(0, 16);
  return `${SCOPED_PREFIX}${digest}`;
}
function credentialsDir(home) {
  return join7(home, "credentials");
}
function credentialPath(home, name = DEFAULT_CREDENTIAL_NAME) {
  return join7(credentialsDir(home), `${name}.json`);
}
function readCredential(options) {
  const now = options.now ?? Math.floor(Date.now() / 1e3);
  let raw;
  try {
    raw = readFileSync5(credentialPath(options.home, options.name), "utf8");
  } catch {
    return { kind: "missing" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { kind: "invalid" };
  const record = parsed;
  const accessToken = record["access_token"];
  const expiresAt = record["expires_at"];
  if (typeof accessToken !== "string" || accessToken.length === 0) return { kind: "invalid" };
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return { kind: "invalid" };
  if (expiresAt <= now + EXPIRY_MARGIN_SECONDS) return { kind: "expired", expiresAt };
  return { kind: "ok", accessToken, expiresAt };
}

// src/quota/fetch.ts
var DEFAULT_FETCH_TIMEOUT_MS = 8e3;
async function fetchUsages(options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/usages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${options.accessToken}`, Accept: "application/json" },
        signal: controller.signal
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return { kind: "error", code: "network", message: aborted ? "request timed out" : describe(error) };
    }
    if (!response.ok) {
      return { kind: "error", code: "http", status: response.status, message: `HTTP ${response.status}` };
    }
    try {
      return { kind: "ok", wire: await response.json() };
    } catch {
      return { kind: "error", code: "bad-response", status: response.status, message: "response was not JSON" };
    }
  } finally {
    clearTimeout(timer);
  }
}
function describe(error) {
  if (error instanceof Error) {
    const cause = error.cause;
    const code = cause instanceof Error && "code" in cause ? String(cause.code) : void 0;
    return code ? `${error.message} (${code})` : error.message;
  }
  return String(error);
}

// src/quota/parse.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function toInt(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}
function toTimeUnit(raw) {
  switch (raw) {
    case "TIME_UNIT_MINUTE":
      return "minute";
    case "TIME_UNIT_HOUR":
      return "hour";
    case "TIME_UNIT_DAY":
      return "day";
    case "TIME_UNIT_WEEK":
      return "week";
    default:
      return null;
  }
}
function toWindow(raw) {
  if (!isRecord(raw)) return void 0;
  const duration = toInt(raw["duration"]);
  const unit = toTimeUnit(raw["timeUnit"]);
  if (duration === null || unit === null) return void 0;
  if (unit === "minute" && duration >= 60 && duration % 60 === 0) {
    return { duration: duration / 60, unit: "hour" };
  }
  return { duration, unit };
}
var UNIT_ABBREV = { minute: "m", hour: "h", day: "d", week: "w" };
function windowName(window) {
  if (!window) return "quota";
  if (window.unit === "week" && window.duration === 1) return "weekly";
  return `${window.duration}${UNIT_ABBREV[window.unit]}`;
}
function toRow(raw, window, wireName) {
  if (!isRecord(raw)) return null;
  const used = toInt(raw["used"]);
  const limit = toInt(raw["limit"]);
  if (used === null && limit === null) return null;
  const name = typeof wireName === "string" && wireName.length > 0 ? wireName : windowName(window);
  const row = { name, used: used ?? 0, limit: limit ?? 0 };
  if (window) row.window = window;
  const resetAt = raw["resetTime"];
  if (typeof resetAt === "string" && resetAt.length > 0) row.resetAt = resetAt;
  return row;
}
var FIXED_POINT_PER_CENT = 1e6;
function fixedPointToCents(value) {
  const cents = value / FIXED_POINT_PER_CENT;
  if (cents > 0 && cents < 1) return 1;
  return Math.round(cents);
}
function toMoney(raw) {
  if (!isRecord(raw)) return null;
  const cents = toInt(raw["priceInCents"]);
  if (cents === null) return null;
  const currency = raw["currency"];
  return { cents, currency: typeof currency === "string" ? currency : "" };
}
function toExtraUsage(raw) {
  if (!isRecord(raw)) return null;
  const balance = raw["balance"];
  if (!isRecord(balance) || balance["type"] !== "BOOSTER") return null;
  const amount = toInt(balance["amount"]);
  if (amount === null || amount <= 0) return null;
  const amountLeft = toInt(balance["amountLeft"]);
  const monthlyLimit = toMoney(raw["monthlyChargeLimit"]);
  const monthlyUsed = toMoney(raw["monthlyUsed"]);
  const currency = monthlyLimit?.currency || monthlyUsed?.currency || "USD";
  return {
    balanceCents: amountLeft === null ? 0 : fixedPointToCents(amountLeft),
    totalCents: fixedPointToCents(amount),
    monthlyChargeLimitEnabled: raw["monthlyChargeLimitEnabled"] === true,
    monthlyChargeLimitCents: monthlyLimit?.cents ?? 0,
    monthlyUsedCents: monthlyUsed?.cents ?? 0,
    currency
  };
}
function parseUsages(wire) {
  if (!isRecord(wire)) return { summary: null, limits: [], extraUsage: null };
  const rawSummary = wire["usage"];
  const summaryWindow = isRecord(rawSummary) ? toWindow(rawSummary["window"]) ?? { duration: 1, unit: "week" } : void 0;
  const summary = toRow(rawSummary, summaryWindow, isRecord(rawSummary) ? rawSummary["name"] : void 0);
  const limits = [];
  const rawLimits = wire["limits"];
  if (Array.isArray(rawLimits)) {
    for (const item of rawLimits) {
      if (!isRecord(item)) continue;
      const row = toRow(item["detail"], toWindow(item["window"]), item["name"]);
      if (row) limits.push(row);
    }
  }
  return { summary, limits, extraUsage: toExtraUsage(wire["boosterWallet"]) };
}

// src/quota/refresh.ts
async function refresh(options) {
  const { env, home } = options;
  const lock = lockPath(env, home);
  if (!acquireLock(lock)) return { kind: "skipped", reason: "locked" };
  try {
    const path = cachePath(env, home);
    const cache = await buildCache(options, readCache(path));
    writeCache(path, cache);
    return { kind: "written", cache };
  } finally {
    releaseLock(lock);
  }
}
async function buildCache(options, previous) {
  const now = options.now ?? Date.now();
  const baseUrl = apiBaseUrl(options.env);
  const base = { schemaVersion: 1, baseUrl, attemptedAt: now };
  const carried = previous ? { fetchedAt: previous.fetchedAt, summary: previous.summary, limits: previous.limits, extraUsage: previous.extraUsage } : { fetchedAt: 0, summary: null, limits: [], extraUsage: null };
  const failure = (errorCode, error, keepData = true) => ({
    ...base,
    ...keepData ? carried : { fetchedAt: 0, summary: null, limits: [], extraUsage: null },
    ok: false,
    error,
    errorCode
  });
  const credential = readCredential({ home: kimiHome(options.env, options.home), now: Math.floor(now / 1e3), name: credentialName(options.env) });
  switch (credential.kind) {
    case "missing":
      return failure("no-auth", "no kimi-code credential found; run /login in kimi-code", false);
    case "invalid":
      return failure("invalid-credential", "kimi-code credential file is unreadable", false);
    case "expired":
      return failure("expired", "kimi-code credential has expired; keep using kimi-code to refresh it");
    case "ok":
      break;
  }
  const fetchOptions = { baseUrl, accessToken: credential.accessToken, ...options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}, ...options.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {} };
  const result = await fetchUsages(fetchOptions);
  if (result.kind === "error") return failure(result.code, result.message);
  const data = parseUsages(result.wire);
  if (data.summary === null && data.limits.length === 0) return failure("bad-response", "usage payload had no recognisable quota");
  return { ...base, fetchedAt: now, ok: true, error: null, errorCode: null, ...data };
}

// src/daemon.ts
function intFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return void 0;
  const n = Number.parseInt(args[index + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : void 0;
}
async function runDaemon(args, ctx) {
  const config = loadConfig(configPath(ctx.env, ctx.home));
  const intervalMs = intFlag(args, "--interval-ms") ?? config.refreshIntervalMs;
  const maxIterations = intFlag(args, "--max-iterations");
  const verbose = args.includes("--verbose");
  let stopped = false;
  let wake = null;
  const stop = () => {
    stopped = true;
    wake?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  for (let i = 0; !stopped && (maxIterations === void 0 || i < maxIterations); i += 1) {
    const outcome = await refresh({ env: ctx.env, home: ctx.home });
    if (verbose) process.stdout.write(`${(/* @__PURE__ */ new Date()).toISOString()} ${JSON.stringify(outcome)}
`);
    if (stopped || maxIterations !== void 0 && i + 1 >= maxIterations) break;
    await new Promise((resolve) => {
      wake = resolve;
      setTimeout(resolve, intervalMs);
    });
    wake = null;
  }
  return 0;
}

// src/doctor.ts
import { existsSync as existsSync3, readFileSync as readFileSync6, readdirSync, statSync as statSync2 } from "fs";
import { join as join8 } from "path";
var OK = "\u2714";
var BAD = "\u2716";
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1e3));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
async function runDoctor(ctx) {
  const { env, home } = ctx;
  const lines = [`kimi-dashboard v${ctx.version} doctor`];
  let healthy = true;
  const row = (label, text) => lines.push(`${label.padEnd(16)} ${text}`);
  const kh = kimiHome(env, home);
  row("kimi-code home", `${kh}${env["KIMI_CODE_HOME"] ? " (KIMI_CODE_HOME)" : ""}`);
  const tuiPath = join8(kh, "tui.toml");
  let tui = "";
  try {
    tui = readFileSync6(tuiPath, "utf8");
  } catch {
  }
  const section = /^\s*\[status_line\][^[]*/m.exec(tui)?.[0] ?? "";
  const command = /^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(section)?.[1];
  if (command) row("tui.toml", `${OK} status_line.command = "${command}"`);
  else {
    healthy = false;
    row("tui.toml", `${BAD} status_line.command not set \u2014 run: kimi-dashboard setup`);
  }
  const name = credentialName(env);
  const credential = readCredential({ home: kh, name });
  const relative = `credentials/${name}.json`;
  const nowS = Math.floor(Date.now() / 1e3);
  switch (credential.kind) {
    case "ok":
      row("credential", `${OK} ${relative} valid, expires in ${ago((credential.expiresAt - nowS) * 1e3)}`);
      break;
    case "expired":
      healthy = false;
      row("credential", `${BAD} ${relative} expired ${ago((nowS - credential.expiresAt) * 1e3)} ago \u2014 keep using kimi-code and it will refresh`);
      break;
    case "invalid":
      healthy = false;
      row("credential", `${BAD} ${relative} unreadable`);
      break;
    case "missing": {
      healthy = false;
      let others = [];
      try {
        others = readdirSync(credentialsDir(kh)).filter((f) => f.endsWith(".json"));
      } catch {
      }
      row("credential", `${BAD} ${credentialPath(kh, name)} missing \u2014 run /login in kimi-code${others.length ? ` (found: ${others.join(", ")})` : ""}`);
      break;
    }
  }
  const baseUrl = apiBaseUrl(env);
  row("api base", `${baseUrl}${env["KIMI_CODE_BASE_URL"] ? " (KIMI_CODE_BASE_URL)" : ""}`);
  const cacheFile = cachePath(env, home);
  const cache = readCache(cacheFile);
  if (cache) {
    const fetched = cache.fetchedAt > 0 ? `fetched ${ago(Date.now() - cache.fetchedAt)} ago` : "no successful fetch yet";
    row("cache", `${cache.ok ? OK : BAD} ${cacheFile} ${fetched}${cache.ok ? "" : `, last error: ${cache.error ?? cache.errorCode ?? "unknown"}`}`);
    if (!cache.ok) healthy = false;
  } else row("cache", `${cacheFile} not written yet (appears after the first statusline run)`);
  const cfgPath = configPath(env, home);
  const cfg = loadConfig(cfgPath);
  row("config", `${existsSync3(cfgPath) ? cfgPath : `(defaults; ${cfgPath} absent)`} segments=${cfg.segments.join(",")} refresh=${cfg.refreshIntervalMs}ms stale=${cfg.staleAfterMs}ms`);
  let keys = [];
  try {
    keys = JSON.parse(readFileSync6(payloadKeysPath(env, home), "utf8"));
  } catch {
  }
  row("payload keys", keys.length ? keys.join(", ") : "none recorded yet (kimi-code has not called statusline)");
  if (ctx.offline) row("connectivity", "skipped (offline)");
  else if (credential.kind !== "ok") row("connectivity", "skipped (no usable credential)");
  else {
    const started = Date.now();
    const result = await fetchUsages({ baseUrl, accessToken: credential.accessToken, timeoutMs: 8e3 });
    if (result.kind === "ok") row("connectivity", `${OK} GET ${baseUrl}/usages \u2192 200 (${Date.now() - started}ms)`);
    else {
      healthy = false;
      row("connectivity", `${BAD} GET ${baseUrl}/usages \u2192 ${result.status ?? result.code}: ${result.message}`);
    }
  }
  const found = findOnPath(env, "kimi-dashboard");
  if (found) row("PATH", `${OK} kimi-dashboard \u2192 ${found}`);
  else row("PATH", `${BAD} kimi-dashboard not on PATH \u2014 install globally (npm i -g kimi-dashboard) or setup --command "node /abs/path/dist/cli.js statusline"`);
  try {
    row("last modified", `${statSync2(tuiPath).mtime.toISOString()} (tui.toml)`);
  } catch {
  }
  process.stdout.write(`${lines.join("\n")}
`);
  return healthy ? 0 : 1;
}

// src/setup.ts
import { mkdirSync as mkdirSync5, readFileSync as readFileSync7, renameSync as renameSync2, writeFileSync as writeFileSync5 } from "fs";
import { dirname as dirname5, join as join9 } from "path";
var SECTION_HEADER = /^\s*\[status_line\]\s*(#.*)?$/;
var ANY_HEADER = /^\s*\[/;
var COMMAND_LINE = /^\s*command\s*=\s*(.*)$/;
function tomlBasicString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function tomlUnquote(raw) {
  const trimmed = raw.trim();
  const basic = /^"((?:[^"\\]|\\.)*)"/.exec(trimmed);
  if (basic) return (basic[1] ?? "").replace(/\\(["\\])/g, "$1");
  const literal = /^'([^']*)'/.exec(trimmed);
  if (literal) return literal[1] ?? "";
  return trimmed.replace(/\s+#.*$/, "");
}
function isOurCommand(command) {
  return /kimi-dashboard(\s|\/|\\|")/.test(command) && /\bstatusline\b/.test(command);
}
function planStatusLineCommand(tomlText, command) {
  const lines = tomlText.split("\n");
  const commandLine = `command = ${tomlBasicString(command)}`;
  const headerIndex = lines.findIndex((line2) => SECTION_HEADER.test(line2));
  if (headerIndex === -1) {
    const body = tomlText.length === 0 || tomlText.endsWith("\n") ? tomlText : `${tomlText}
`;
    const gap = body.length === 0 ? "" : "\n";
    return { kind: "write", text: `${body}${gap}[status_line]
${commandLine}
` };
  }
  let sectionEnd = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (ANY_HEADER.test(lines[i] ?? "")) {
      sectionEnd = i;
      break;
    }
  }
  for (let i = headerIndex + 1; i < sectionEnd; i += 1) {
    const match = COMMAND_LINE.exec(lines[i] ?? "");
    if (!match) continue;
    const existing = tomlUnquote(match[1] ?? "");
    if (existing === command) return { kind: "unchanged" };
    const replaced = [...lines];
    replaced[i] = commandLine;
    if (isOurCommand(existing)) return { kind: "write", text: replaced.join("\n") };
    return { kind: "conflict", existing, text: replaced.join("\n") };
  }
  const inserted = [...lines];
  inserted.splice(headerIndex + 1, 0, commandLine);
  return { kind: "write", text: inserted.join("\n") };
}
var DEFAULT_COMMAND = "kimi-dashboard statusline";
function flagValue2(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? void 0 : args[index + 1];
}
function writeAtomic(path, text) {
  mkdirSync5(dirname5(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync5(tmp, text, "utf8");
  renameSync2(tmp, path);
}
async function confirm(question) {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}
async function runSetup(args, ctx) {
  const quiet = args.includes("--quiet");
  const explicit = flagValue2(args, "--command");
  const command = explicit ?? (args.includes("--self") && ctx.selfPath ? `node "${ctx.selfPath}" statusline` : DEFAULT_COMMAND);
  const tuiPath = join9(kimiHome(ctx.env, ctx.home), "tui.toml");
  const say = (text2) => {
    if (!quiet) process.stdout.write(`${text2}
`);
  };
  let text = "";
  try {
    text = readFileSync7(tuiPath, "utf8");
  } catch {
  }
  const plan = planStatusLineCommand(text, command);
  switch (plan.kind) {
    case "unchanged":
      say(`\u2714 nothing to do: ${tuiPath} status_line.command = "${command}"`);
      break;
    case "write":
      writeAtomic(tuiPath, plan.text);
      say(`\u2714 wrote [status_line] command = "${command}" to ${tuiPath}`);
      break;
    case "conflict": {
      say(`\u2716 ${tuiPath} has a different status_line.command: "${plan.existing}"`);
      if (!args.includes("--force")) {
        if (quiet || !process.stdin.isTTY) {
          say(`   left unchanged; re-run with --force to replace it with "${command}"`);
          return 2;
        }
        if (!await confirm(`Replace it with "${command}"? [y/N] `)) {
          say("left unchanged");
          return 2;
        }
      }
      writeAtomic(tuiPath, plan.text);
      say(`\u2714 replaced it with "${command}" in ${tuiPath}`);
      break;
    }
  }
  if (command.startsWith("kimi-dashboard") && findOnPath(ctx.env, "kimi-dashboard") === null) {
    say(`\u26A0 kimi-dashboard is not on PATH right now; install it globally (npm i -g kimi-dashboard) or re-run with --command "node /abs/path/dist/cli.js statusline"`);
  }
  say("Run /reload in kimi-code (or restart it) to apply.");
  return 0;
}

// src/cli.ts
var VERSION = "0.1.0";
var HELP = `kimi-dashboard v${VERSION} \u2014 Kimi Code quota in the kimi-code footer (unofficial)

Usage: kimi-dashboard <command> [options]

  statusline   read the kimi-code payload from stdin, print one footer line
  refresh      fetch /usages once and update the cache        [--json]
  daemon       keep refreshing on an interval (optional)      [--interval-ms N] [--verbose]
  setup        write [status_line] command into tui.toml      [--force] [--command "<cmd>"]
  doctor       check credential / cache / config / connectivity
  preview      render sample data, no network                 [--hot] [--stale] [--no-auth] [--expired] [--empty] [--not-kimi] [--bar] [--ascii] [--width N] [--color]
  config       show or change what the line displays         [compact|full|quota] [key=value ...]
               e.g. config compact lang=zh \xB7 config segments=model,5h,7d,git quotaStyle=bar separator=dot
  lang         print the language to talk to the user in (zh|en): config lang, else $LANG
`;
var SELF = fileURLToPath(import.meta.url);
function spawnRefresh() {
  try {
    const child = spawn(process.execPath, [SELF, "refresh"], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {
    });
    child.unref();
  } catch {
  }
}
function runStatusline() {
  process.on("uncaughtException", () => {
  });
  let stdin = "";
  try {
    stdin = readFileSync8(0, "utf8");
  } catch {
  }
  const line2 = statusline({ stdin, env: process.env, home: homedir(), spawnRefresh });
  process.stdout.write(`${line2}
`);
  return 0;
}
async function runRefresh(args) {
  const outcome = await refresh({ env: process.env, home: homedir() });
  if (args.includes("--json")) process.stdout.write(`${JSON.stringify(outcome)}
`);
  return 0;
}
async function main(argv) {
  const [command = "help", ...rest] = argv;
  switch (command) {
    case "statusline":
      return runStatusline();
    case "refresh":
      return runRefresh(rest);
    case "daemon":
      return runDaemon(rest, { env: process.env, home: homedir() });
    case "setup":
      return runSetup(rest, { env: process.env, home: homedir(), selfPath: SELF });
    case "doctor":
      return runDoctor({ env: process.env, home: homedir(), version: VERSION });
    case "preview":
      return runPreview(rest, { env: process.env, home: homedir() });
    case "config":
      return runConfig(rest, { env: process.env, home: homedir() });
    case "lang":
      process.stdout.write(`${detectLang(loadConfig(configPath(process.env, homedir())).lang, process.env)}
`);
      return 0;
    case "--version":
    case "-v":
    case "version":
      process.stdout.write(`${VERSION}
`);
      return 0;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`unknown command: ${command}

${HELP}`);
      return 1;
  }
}
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 1;
  }
);
export {
  VERSION,
  main
};
