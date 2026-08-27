/**
 * Hot path (SPEC §3): stdin → cache file → one line. No network, no
 * credentials, no stderr, no non-zero exit. Anything unexpected renders as "".
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configPath, loadConfig, type DashboardConfig, type SegmentId } from "./config.js";
import { detectLang } from "./lang.js";
import { kimiHome } from "./paths.js";
import { modelProviderKind } from "./provider.js";
import { cacheDir, cachePath, readCache } from "./quota/cache.js";
import { isLockFresh, lockPath } from "./quota/lock.js";
import { render, type ColorDepth, type QuotaView } from "./render.js";
import type { QuotaCache, StatusLinePayload } from "./types.js";

export interface StatuslineInput {
  stdin: string;
  env: NodeJS.ProcessEnv;
  /** OS home directory. */
  home: string;
  /** Unix ms; defaults to the wall clock. */
  now?: number;
  /** Pre-loaded config; defaults to reading the config file. */
  config?: DashboardConfig;
  /** Detach a `refresh` process. Must not block. */
  spawnRefresh: () => void;
}

export const DEFAULT_COLUMNS = 120;

export function statusline(input: StatuslineInput): string {
  try {
    return run(input);
  } catch {
    return "";
  }
}

const QUOTA_SEGMENTS: ReadonlySet<SegmentId> = new Set(["5h", "7d", "booster", "spend"]);
const MAX_TRACKED_SESSIONS = 50;

export function sessionsPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(cacheDir(env, home), "sessions.json");
}

/**
 * When was this sessionId first seen? kimi-code does not send a start time,
 * so remember the first sighting (one tiny read per tick, a write only for a
 * new session). Anything failing here just makes the session look brand new.
 */
function sessionStartedAt(env: NodeJS.ProcessEnv, home: string, sessionId: string | undefined, now: number): number | undefined {
  if (!sessionId) return undefined;
  const path = sessionsPath(env, home);
  let store: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) store = parsed as Record<string, unknown>;
  } catch {
    // first session on this machine
  }
  const known = store[sessionId];
  if (typeof known === "number" && Number.isFinite(known)) return known;
  const kept = Object.entries(store)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TRACKED_SESSIONS - 1);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(Object.fromEntries([[sessionId, now], ...kept]))}\n`);
  } catch {
    // read-only cache dir: fine, the segment just restarts from now each tick
  }
  return now;
}

/** Kimi quota is meaningless while e.g. DeepSeek is active; kimi-code's config.toml says which is which. */
function hideQuota(config: DashboardConfig, model: string | undefined, env: NodeJS.ProcessEnv, home: string): boolean {
  if (config.quotaWhenNotKimi !== "hide" || !model) return false;
  let text: string;
  try {
    text = readFileSync(join(kimiHome(env, home), "config.toml"), "utf8");
  } catch {
    return false;
  }
  return modelProviderKind(text, model) === "other";
}

/** Where the last-seen payload field names live, for `doctor` (SPEC §10). */
export function payloadKeysPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(cacheDir(env, home), "payload-keys.json");
}

/** Only rewrites when the key set changes, so the hot path normally does one cheap read. */
function recordPayloadKeys(env: NodeJS.ProcessEnv, home: string, keys: string[]): void {
  const path = payloadKeysPath(env, home);
  const next = JSON.stringify(keys);
  try {
    if (readFileSync(path, "utf8").trim() === next) return;
  } catch {
    // first run
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${next}\n`);
  } catch {
    // diagnostics only; never affects the line
  }
}

function run(input: StatuslineInput): string {
  const parsed = parsePayload(input.stdin);
  if (parsed === null) return "";
  const { payload, keys } = parsed;
  const { env, home } = input;
  recordPayloadKeys(env, home, keys);
  const now = input.now ?? Date.now();
  const loaded = input.config ?? loadConfig(configPath(env, home));
  const config = hideQuota(loaded, payload.model, env, home) ? { ...loaded, segments: loaded.segments.filter((s) => !QUOTA_SEGMENTS.has(s)) } : loaded;
  const showsQuota = config.segments.some((s) => QUOTA_SEGMENTS.has(s));
  const cache = readCache(cachePath(env, home));

  if (showsQuota && shouldRefresh(cache, now, config) && !isLockFresh(lockPath(env, home))) input.spawnRefresh();

  const colors = colorDepth(env);
  const startedAt = config.segments.includes("session") ? sessionStartedAt(env, home, payload.sessionId, now) : undefined;
  return render({
    payload,
    quota: quotaView(cache, now, config),
    config: colors === 0 ? { ...config, ascii: true } : config,
    columns: columnsFrom(env),
    colors,
    now,
    home,
    lang: detectLang(config.lang, env),
    ...(startedAt !== undefined ? { sessionStartedAt: startedAt } : {}),
  });
}

/** Loose parse: must be a JSON object; wrongly typed fields are dropped, never fatal. */
export function parsePayload(stdin: string): { payload: StatusLinePayload; keys: string[] } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const payload: StatusLinePayload = {};
  const str = (key: "model" | "cwd" | "permissionMode" | "sessionId" | "version") => {
    const v = rec[key];
    if (typeof v === "string") payload[key] = v;
  };
  const num = (key: "contextUsage" | "contextTokens" | "maxContextTokens") => {
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
  if (typeof rec["gitBranch"] === "string" || rec["gitBranch"] === null) payload.gitBranch = rec["gitBranch"] as string | null;
  if (typeof rec["planMode"] === "boolean") payload.planMode = rec["planMode"];
  return { payload, keys: Object.keys(rec) };
}

function hasData(cache: QuotaCache): boolean {
  return cache.summary !== null || cache.limits.length > 0;
}

export function quotaView(cache: QuotaCache | null, now: number, config: DashboardConfig): QuotaView {
  if (cache === null) return { kind: "none" };
  if (cache.errorCode === "no-auth" || cache.errorCode === "invalid-credential") return { kind: "no-auth" };
  if (hasData(cache)) return { kind: "data", stale: now - cache.fetchedAt > config.staleAfterMs, data: cache };
  if (cache.errorCode === "expired") return { kind: "expired" };
  return { kind: "none" };
}

function shouldRefresh(cache: QuotaCache | null, now: number, config: DashboardConfig): boolean {
  if (cache === null) return true;
  return now - cache.attemptedAt >= config.refreshIntervalMs;
}

/** NO_COLOR (non-empty) or TERM=dumb → plain text + ASCII bars (SPEC §7); 256 colours when the terminal says so. */
export function colorDepth(env: NodeJS.ProcessEnv): ColorDepth {
  const noColor = env["NO_COLOR"];
  const term = env["TERM"] ?? "";
  if ((noColor !== undefined && noColor !== "") || term === "dumb") return 0;
  const colorterm = env["COLORTERM"] ?? "";
  if (colorterm === "truecolor" || colorterm === "24bit" || term.includes("256color")) return 256;
  return 16;
}

export function columnsFrom(env: NodeJS.ProcessEnv): number {
  const n = Number.parseInt(env["COLUMNS"] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COLUMNS;
}
