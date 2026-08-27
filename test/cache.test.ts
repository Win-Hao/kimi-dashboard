import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readCache, writeCache } from "../src/quota/cache.js";
import type { QuotaCache } from "../src/types.js";

const sample: QuotaCache = {
  schemaVersion: 1,
  fetchedAt: 1786080229400,
  attemptedAt: 1786080229400,
  baseUrl: "https://api.kimi.com/coding/v1",
  ok: true,
  error: null,
  errorCode: null,
  summary: { name: "weekly", window: { duration: 1, unit: "week" }, used: 40, limit: 1000, resetAt: "2026-08-03T05:20:51Z" },
  limits: [{ name: "5h", window: { duration: 5, unit: "hour" }, used: 1, limit: 100, resetAt: "2026-08-03T05:20:51Z" }],
  extraUsage: null,
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "kimi-dashboard-cache-"));
}

test("a written cache reads back identically, creating missing parent directories and leaving no temp files", () => {
  const path = join(tempDir(), "nested", "deeper", "quota.json");
  writeCache(path, sample);
  expect(readCache(path)).toEqual(sample);
  expect(readdirSync(join(path, ".."))).toEqual(["quota.json"]);
});

test("missing, corrupt, foreign-schema or wrongly shaped files all read as no cache", () => {
  const dir = tempDir();
  expect(readCache(join(dir, "nope.json"))).toBeNull();
  writeFileSync(join(dir, "corrupt.json"), "{ not json");
  expect(readCache(join(dir, "corrupt.json"))).toBeNull();
  writeFileSync(join(dir, "v2.json"), JSON.stringify({ ...sample, schemaVersion: 2 }));
  expect(readCache(join(dir, "v2.json"))).toBeNull();
  writeFileSync(join(dir, "array.json"), "[1,2,3]");
  expect(readCache(join(dir, "array.json"))).toBeNull();
  mkdirSync(join(dir, "adir.json"));
  expect(readCache(join(dir, "adir.json"))).toBeNull();
});

test("the cache lives under XDG_CACHE_HOME, defaulting to ~/.cache", async () => {
  const { cachePath } = await import("../src/quota/cache.js");
  expect(cachePath({ XDG_CACHE_HOME: "/tmp/xdg" }, "/home/me")).toBe("/tmp/xdg/kimi-dashboard/quota.json");
  expect(cachePath({ XDG_CACHE_HOME: "" }, "/home/me")).toBe("/home/me/.cache/kimi-dashboard/quota.json");
  expect(cachePath({}, "/home/me")).toBe("/home/me/.cache/kimi-dashboard/quota.json");
});
