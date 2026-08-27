import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { QuotaCache } from "../types.js";

export const CACHE_SCHEMA_VERSION = 1;

/** XDG on every platform, macOS included, so users can find the file (SPEC §4). */
export function cacheDir(env: NodeJS.ProcessEnv, home: string): string {
  const base = env["XDG_CACHE_HOME"]?.trim();
  return join(base && base.length > 0 ? base : join(home, ".cache"), "kimi-dashboard");
}

export function cachePath(env: NodeJS.ProcessEnv, home: string): string {
  return join(cacheDir(env, home), "quota.json");
}

/** Missing, unreadable, corrupt, or foreign-schema files all read as "no cache". */
export function readCache(path: string): QuotaCache | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const cache = parsed as Partial<QuotaCache>;
    if (cache.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    return cache as QuotaCache;
  } catch {
    return null;
  }
}

/** Write tmp → rename so a concurrent statusline never sees half a file. */
export function writeCache(path: string, cache: QuotaCache): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(16).slice(2, 8)}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(cache)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing to clean up
    }
    throw error;
  }
}
