import { apiBaseUrl, kimiHome } from "../paths.js";
import type { CacheErrorCode, QuotaCache } from "../types.js";
import { cachePath, readCache, writeCache } from "./cache.js";
import { credentialName, readCredential } from "./creds.js";
import { fetchUsages } from "./fetch.js";
import { acquireLock, lockPath, releaseLock } from "./lock.js";
import { parseUsages } from "./parse.js";

export interface RefreshOptions {
  env: NodeJS.ProcessEnv;
  /** OS home directory (for the XDG cache default). */
  home: string;
  /** Unix ms; defaults to the wall clock. */
  now?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type RefreshOutcome = { kind: "skipped"; reason: "locked" } | { kind: "written"; cache: QuotaCache };

/**
 * One refresh: read credential (read-only) → GET /usages → write cache.
 * Failures still write a cache entry so the status line can explain itself;
 * previously fetched data is carried forward and simply ages into "stale".
 */
export async function refresh(options: RefreshOptions): Promise<RefreshOutcome> {
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

async function buildCache(options: RefreshOptions, previous: QuotaCache | null): Promise<QuotaCache> {
  const now = options.now ?? Date.now();
  const baseUrl = apiBaseUrl(options.env);
  const base = { schemaVersion: 1 as const, baseUrl, attemptedAt: now };
  const carried = previous
    ? { fetchedAt: previous.fetchedAt, summary: previous.summary, limits: previous.limits, extraUsage: previous.extraUsage }
    : { fetchedAt: 0, summary: null, limits: [], extraUsage: null };
  const failure = (errorCode: CacheErrorCode, error: string, keepData = true): QuotaCache => ({
    ...base,
    ...(keepData ? carried : { fetchedAt: 0, summary: null, limits: [], extraUsage: null }),
    ok: false,
    error,
    errorCode,
  });

  const credential = readCredential({ home: kimiHome(options.env, options.home), now: Math.floor(now / 1000), name: credentialName(options.env) });
  switch (credential.kind) {
    case "missing":
      return failure("no-auth", "no kimi-code credential found; run /login in kimi-code", false);
    case "invalid":
      return failure("invalid-credential", "kimi-code credential file is unreadable", false);
    case "expired":
      // Never refresh the token ourselves (SPEC §6.2); kimi-code will on its next request.
      return failure("expired", "kimi-code credential has expired; keep using kimi-code to refresh it");
    case "ok":
      break;
  }

  const fetchOptions = { baseUrl, accessToken: credential.accessToken, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) };
  const result = await fetchUsages(fetchOptions);
  if (result.kind === "error") return failure(result.code, result.message);
  const data = parseUsages(result.wire);
  if (data.summary === null && data.limits.length === 0) return failure("bad-response", "usage payload had no recognisable quota");
  return { ...base, fetchedAt: now, ok: true, error: null, errorCode: null, ...data };
}
