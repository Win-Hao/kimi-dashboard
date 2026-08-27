import { mkdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir } from "./cache.js";

/** A lock older than this is a leftover from a dead refresh and may be taken over (SPEC §3.2). */
export const LOCK_STALE_MS = 30_000;

export function lockPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(cacheDir(env, home), "refresh.lock");
}

/** True while another refresh is believed to be running (lock exists and is younger than staleMs). */
export function isLockFresh(path: string, staleMs = LOCK_STALE_MS): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < staleMs;
  } catch {
    return false;
  }
}

/** Create-exclusive; a stale lock is overwritten. Returns false when someone else holds it. */
export function acquireLock(path: string, staleMs = LOCK_STALE_MS): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${process.pid}\n`, { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
  }
  if (isLockFresh(path, staleMs)) return false;
  try {
    writeFileSync(path, `${process.pid}\n`);
    const now = new Date();
    utimesSync(path, now, now);
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}
