#!/usr/bin/env node
/**
 * Cold-start benchmark for the hot path (SPEC §6.1): spawn `dist/cli.js statusline`
 * N times with a fresh cache in place and fail when p99 exceeds the budget.
 *
 *   KIMI_DASHBOARD_BENCH_RUNS=40 KIMI_DASHBOARD_BENCH_MAX_P99_MS=150 node scripts/bench.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli.js");
const runs = Number.parseInt(process.env.KIMI_DASHBOARD_BENCH_RUNS ?? "40", 10);
const maxP99 = Number.parseFloat(process.env.KIMI_DASHBOARD_BENCH_MAX_P99_MS ?? "150");

const cacheHome = mkdtempSync(join(tmpdir(), "kimi-dashboard-bench-"));
mkdirSync(join(cacheHome, "kimi-dashboard"), { recursive: true });
const now = Date.now();
writeFileSync(
  join(cacheHome, "kimi-dashboard", "quota.json"),
  JSON.stringify({
    schemaVersion: 1,
    fetchedAt: now,
    attemptedAt: now,
    baseUrl: "https://api.kimi.com/coding/v1",
    ok: true,
    error: null,
    errorCode: null,
    summary: { name: "weekly", window: { duration: 1, unit: "week" }, used: 340, limit: 1000 },
    limits: [{ name: "5h", window: { duration: 5, unit: "hour" }, used: 18, limit: 100 }],
    extraUsage: null,
  }),
);
const payload = JSON.stringify({ model: "kimi-k2", cwd: root, gitBranch: "main", contextUsage: 0.32, contextTokens: 64000, maxContextTokens: 200000 });
const env = { ...process.env, XDG_CACHE_HOME: cacheHome, XDG_CONFIG_HOME: join(cacheHome, "config"), KIMI_CODE_HOME: join(cacheHome, "kimi-home") };

const samples = [];
let lastLine = "";
for (let i = 0; i < runs + 3; i += 1) {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [cli, "statusline"], { input: payload, encoding: "utf8", env });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.status !== 0 || result.stderr.length > 0) {
    console.error(`run ${i} failed: status=${result.status} stderr=${result.stderr}`);
    process.exit(1);
  }
  lastLine = result.stdout.trimEnd();
  if (i >= 3) samples.push(elapsedMs); // discard warm-up
}
samples.sort((a, b) => a - b);
const pct = (p) => samples[Math.min(samples.length - 1, Math.ceil((p / 100) * samples.length) - 1)];
const p50 = pct(50);
const p99 = pct(99);
console.log(`statusline cold start over ${samples.length} runs: p50=${p50.toFixed(1)}ms p99=${p99.toFixed(1)}ms max=${samples[samples.length - 1].toFixed(1)}ms`);
console.log(`line: ${lastLine}`);
if (p99 > maxP99) {
  console.error(`p99 ${p99.toFixed(1)}ms exceeds budget ${maxP99}ms`);
  process.exit(1);
}
