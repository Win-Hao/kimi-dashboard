import { readFileSync, statSync, writeFileSync, utimesSync, mkdirSync, chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readCache, writeCache } from "../src/quota/cache.js";
import { credentialName } from "../src/quota/creds.js";
import { refresh } from "../src/quota/refresh.js";
import type { QuotaCache, QuotaData } from "../src/types.js";
import { makeKimiHome, startUsagesServer, tempDir } from "./helpers.js";

const wire = readFileSync(new URL("./fixtures/usages.json", import.meta.url), "utf8");
const NOW_MS = 1_786_080_000_000;
const NOW_S = NOW_MS / 1000;
const REFRESH_TOKEN = "rt-SECRET";
const validCredential = { access_token: "at-abc", refresh_token: REFRESH_TOKEN, expires_at: NOW_S + 3600 };

function envFor(kimiHome: string, baseUrl: string, cacheHome = tempDir("kimi-cache-")): NodeJS.ProcessEnv {
  return { KIMI_CODE_HOME: kimiHome, KIMI_CODE_BASE_URL: baseUrl, XDG_CACHE_HOME: cacheHome };
}

/** With a custom base URL kimi-code keeps the token in an env-scoped slot; mirror that. */
function homeFor(baseUrl: string, credential?: unknown): string {
  return makeKimiHome(credential, credentialName({ KIMI_CODE_BASE_URL: baseUrl }));
}

const expectedData: QuotaData = {
  summary: { name: "weekly", window: { duration: 1, unit: "week" }, used: 40, limit: 1000, resetAt: "2026-08-03T05:20:51Z" },
  limits: [{ name: "5h", window: { duration: 5, unit: "hour" }, used: 18, limit: 100, resetAt: "2026-08-01T09:00:00Z" }],
  extraUsage: { balanceCents: 4200, totalCents: 10000, monthlyChargeLimitEnabled: true, monthlyChargeLimitCents: 20000, monthlyUsedCents: 5800, currency: "CNY" },
};

test("refresh fetches /usages with the stored token and writes the normalised cache", async () => {
  const server = await startUsagesServer(() => ({ status: 200, body: wire }));
  const env = envFor(homeFor(server.baseUrl, validCredential), server.baseUrl);
  try {
    const outcome = await refresh({ env, home: "/nonexistent-os-home", now: NOW_MS });
    const expected: QuotaCache = {
      schemaVersion: 1,
      fetchedAt: NOW_MS,
      attemptedAt: NOW_MS,
      baseUrl: server.baseUrl,
      ok: true,
      error: null,
      errorCode: null,
      ...expectedData,
    };
    expect(outcome).toEqual({ kind: "written", cache: expected });
    expect(readCache(join(env["XDG_CACHE_HOME"]!, "kimi-dashboard", "quota.json"))).toEqual(expected);
    expect(server.requests[0]!.headers["authorization"]).toBe("Bearer at-abc");
  } finally {
    await server.close();
  }
});

test("without a credential the cache records no-auth and the network is never touched", async () => {
  const server = await startUsagesServer(() => ({ status: 200, body: wire }));
  const env = envFor(homeFor(server.baseUrl), server.baseUrl);
  try {
    const outcome = await refresh({ env, home: "/nonexistent-os-home", now: NOW_MS });
    expect(outcome).toMatchObject({ kind: "written", cache: { ok: false, errorCode: "no-auth", summary: null, limits: [], attemptedAt: NOW_MS } });
    expect(server.requests).toHaveLength(0);
  } finally {
    await server.close();
  }
});

test("an expired credential is never refreshed: old quota is carried forward and marked, no request is made", async () => {
  const server = await startUsagesServer(() => ({ status: 200, body: wire }));
  const env = envFor(homeFor(server.baseUrl, { ...validCredential, expires_at: NOW_S + 30 }), server.baseUrl);
  const cacheFile = join(env["XDG_CACHE_HOME"]!, "kimi-dashboard", "quota.json");
  const earlier: QuotaCache = { schemaVersion: 1, fetchedAt: NOW_MS - 300_000, attemptedAt: NOW_MS - 300_000, baseUrl: server.baseUrl, ok: true, error: null, errorCode: null, ...expectedData };
  writeCache(cacheFile, earlier);
  try {
    const outcome = await refresh({ env, home: "/nonexistent-os-home", now: NOW_MS });
    expect(outcome).toEqual({
      kind: "written",
      cache: { ...earlier, attemptedAt: NOW_MS, ok: false, errorCode: "expired", error: "kimi-code credential has expired; keep using kimi-code to refresh it" },
    });
    expect(server.requests).toHaveLength(0);
    expect(JSON.stringify(outcome)).not.toContain("SECRET");
  } finally {
    await server.close();
  }
});

test("an HTTP failure keeps the previous quota and records the error", async () => {
  const server = await startUsagesServer(() => ({ status: 503, body: "{}" }));
  const env = envFor(homeFor(server.baseUrl, validCredential), server.baseUrl);
  const cacheFile = join(env["XDG_CACHE_HOME"]!, "kimi-dashboard", "quota.json");
  const earlier: QuotaCache = { schemaVersion: 1, fetchedAt: NOW_MS - 300_000, attemptedAt: NOW_MS - 300_000, baseUrl: server.baseUrl, ok: true, error: null, errorCode: null, ...expectedData };
  writeCache(cacheFile, earlier);
  try {
    const outcome = await refresh({ env, home: "/nonexistent-os-home", now: NOW_MS });
    expect(outcome).toEqual({ kind: "written", cache: { ...earlier, attemptedAt: NOW_MS, ok: false, errorCode: "http", error: "HTTP 503" } });
  } finally {
    await server.close();
  }
});

test("a fresh lock file makes refresh step aside; a stale one (>30s) is taken over and removed afterwards", async () => {
  const server = await startUsagesServer(() => ({ status: 200, body: wire }));
  const env = envFor(homeFor(server.baseUrl, validCredential), server.baseUrl);
  const lockFile = join(env["XDG_CACHE_HOME"]!, "kimi-dashboard", "refresh.lock");
  mkdirSync(join(env["XDG_CACHE_HOME"]!, "kimi-dashboard"), { recursive: true });
  try {
    writeFileSync(lockFile, "99999\n");
    expect(await refresh({ env, home: "/nonexistent-os-home", now: NOW_MS })).toEqual({ kind: "skipped", reason: "locked" });
    expect(server.requests).toHaveLength(0);
    expect(readFileSync(lockFile, "utf8")).toBe("99999\n");

    const old = new Date(Date.now() - 31_000);
    utimesSync(lockFile, old, old);
    expect(await refresh({ env, home: "/nonexistent-os-home", now: NOW_MS })).toMatchObject({ kind: "written", cache: { ok: true } });
    expect(server.requests).toHaveLength(1);
    expect(() => statSync(lockFile)).toThrow();
  } finally {
    await server.close();
  }
});

test("refresh works with a read-only credentials directory and leaves it byte-for-byte untouched", async () => {
  const server = await startUsagesServer(() => ({ status: 200, body: wire }));
  const kimiHome = homeFor(server.baseUrl, validCredential);
  const credDir = join(kimiHome, "credentials");
  const credFile = join(credDir, `${credentialName({ KIMI_CODE_BASE_URL: server.baseUrl })}.json`);
  const before = { content: readFileSync(credFile, "utf8"), mtimeMs: statSync(credFile).mtimeMs, entries: readdirSync(credDir) };
  chmodSync(credFile, 0o400);
  chmodSync(credDir, 0o500);
  try {
    const outcome = await refresh({ env: envFor(kimiHome, server.baseUrl), home: "/nonexistent-os-home", now: NOW_MS });
    expect(outcome).toMatchObject({ kind: "written", cache: { ok: true } });
    expect(readdirSync(credDir)).toEqual(before.entries);
    expect(readFileSync(credFile, "utf8")).toBe(before.content);
    expect(statSync(credFile).mtimeMs).toBe(before.mtimeMs);
  } finally {
    chmodSync(credDir, 0o700);
    chmodSync(credFile, 0o600);
    await server.close();
  }
});
