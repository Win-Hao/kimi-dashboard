import { copyFileSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { writeCache } from "../src/quota/cache.js";
import { statusline } from "../src/statusline.js";
import type { QuotaCache } from "../src/types.js";
import { tempDir } from "./helpers.js";

const NOW = 1_786_080_000_000;
const payload = JSON.stringify({
  model: "kimi-k2",
  cwd: "/Users/you/proj",
  gitBranch: "main",
  permissionMode: "auto",
  planMode: false,
  contextUsage: 0.32,
  contextTokens: 64000,
  maxContextTokens: 200000,
  sessionId: "session_x",
  version: "1.2.3",
});

const goodData = {
  summary: { name: "weekly", window: { duration: 1, unit: "week" as const }, used: 90, limit: 1000 },
  limits: [{ name: "5h", window: { duration: 5, unit: "hour" as const }, used: 18, limit: 100 }],
  extraUsage: null,
};

interface Harness {
  env: NodeJS.ProcessEnv;
  cacheFile: string;
  lockFile: string;
  spawned: () => number;
  run: (stdin?: string, envExtra?: NodeJS.ProcessEnv) => string;
}

function harness(): Harness {
  const cacheHome = tempDir("kimi-cache-");
  const configHome = tempDir("kimi-config-");
  // NO_COLOR by default keeps expectations readable; the colour test opts back in.
  const env: NodeJS.ProcessEnv = { XDG_CACHE_HOME: cacheHome, XDG_CONFIG_HOME: configHome, KIMI_CODE_HOME: tempDir("kimi-home-"), NO_COLOR: "1", COLUMNS: "200" };
  let spawned = 0;
  return {
    env,
    cacheFile: join(cacheHome, "kimi-dashboard", "quota.json"),
    lockFile: join(cacheHome, "kimi-dashboard", "refresh.lock"),
    spawned: () => spawned,
    run: (stdin = payload, envExtra = {}) =>
      statusline({ stdin, env: { ...env, ...envExtra }, home: "/Users/you", now: NOW, spawnRefresh: () => { spawned += 1; } }),
  };
}

function cacheWith(overrides: Partial<QuotaCache>): QuotaCache {
  return { schemaVersion: 1, fetchedAt: NOW - 1000, attemptedAt: NOW - 1000, baseUrl: "https://api.kimi.com/coding/v1", ok: true, error: null, errorCode: null, ...goodData, ...overrides };
}

test("with no cache yet the line shows -- for quota and a background refresh is spawned", () => {
  const h = harness();
  expect(h.run()).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h: -- | 7d: -- | auto | main | proj | <1m | v1.2.3");
  expect(h.spawned()).toBe(1);
});

test("malformed stdin yields an empty line so the host footer falls back, and nothing is spawned", () => {
  const h = harness();
  expect(h.run("{ not json")).toBe("");
  expect(h.run("")).toBe("");
  expect(h.run("[1,2]")).toBe("");
  expect(h.run("null")).toBe("");
  expect(h.spawned()).toBe(0);
});

test("a fresh cache renders the bars and does not spawn anything", () => {
  const h = harness();
  writeCache(h.cacheFile, cacheWith({}));
  expect(h.run()).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h: 18% | 7d: 9% | auto | main | proj | <1m | v1.2.3");
  expect(h.spawned()).toBe(0);
});

test("past refreshIntervalMs the line is unchanged but a refresh is spawned; past staleAfterMs it is marked ~", () => {
  const h = harness();
  writeCache(h.cacheFile, cacheWith({ fetchedAt: NOW - 180_000, attemptedAt: NOW - 180_000 }));
  expect(h.run()).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h: 18% | 7d: 9% | auto | main | proj | <1m | v1.2.3");
  expect(h.spawned()).toBe(1);
  writeCache(h.cacheFile, cacheWith({ fetchedAt: NOW - 660_000, attemptedAt: NOW - 660_000 }));
  expect(h.run()).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | ~5h: 18% | ~7d: 9% | auto | main | proj | <1m | v1.2.3");
  expect(h.spawned()).toBe(2);
  // a failed attempt a moment ago throttles re-spawns even though the data is old
  writeCache(h.cacheFile, cacheWith({ fetchedAt: NOW - 660_000, attemptedAt: NOW - 5_000, ok: false, errorCode: "network", error: "boom" }));
  expect(h.run()).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | ~5h: 18% | ~7d: 9% | auto | main | proj | <1m | v1.2.3");
  expect(h.spawned()).toBe(2);
});

test("a live refresh lock suppresses spawning; a dead one (>30s) does not", () => {
  const h = harness();
  mkdirSync(join(h.lockFile, ".."), { recursive: true });
  writeFileSync(h.lockFile, "123\n");
  expect(h.run()).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h: -- | 7d: -- | auto | main | proj | <1m | v1.2.3");
  expect(h.spawned()).toBe(0);
  const old = new Date(Date.now() - 31_000);
  utimesSync(h.lockFile, old, old);
  h.run();
  expect(h.spawned()).toBe(1);
});

test("credential problems recorded by refresh show as no auth / expired hint / stale bars", () => {
  const h = harness();
  writeCache(h.cacheFile, cacheWith({ ok: false, errorCode: "no-auth", error: "x", summary: null, limits: [] }));
  expect(h.run()).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h/7d no auth | auto | main | proj | <1m | v1.2.3");
  writeCache(h.cacheFile, cacheWith({ ok: false, errorCode: "expired", error: "x", summary: null, limits: [], fetchedAt: 0 }));
  expect(h.run(payload, { LANG: "zh_CN.UTF-8" })).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 额度不可用 · 请在 kimi-code 中继续使用以刷新凭证 | auto | main | proj | <1m | v1.2.3");
  writeCache(h.cacheFile, cacheWith({ ok: false, errorCode: "expired", error: "x", fetchedAt: NOW - 900_000 }));
  expect(h.run()).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | ~5h: 18% | ~7d: 9% | auto | main | proj | <1m | v1.2.3");
});

test("NO_COLOR or TERM=dumb drop ANSI and use ASCII bars; COLUMNS narrows the line; config file is honoured", () => {
  const h = harness();
  writeCache(h.cacheFile, cacheWith({}));
  expect(h.run(payload, { NO_COLOR: "", TERM: "xterm-256color" })).toBe(
    "\x1b[38;5;117m◆ kimi-k2\x1b[0m \x1b[2m│\x1b[0m \x1b[38;5;151m███░░░░░░░ 32%\x1b[0m \x1b[2m│\x1b[0m 62.5k/195k \x1b[2m│\x1b[0m 5h: \x1b[38;5;151m18%\x1b[0m \x1b[2m│\x1b[0m 7d: \x1b[38;5;151m9%\x1b[0m \x1b[2m│\x1b[0m \x1b[1;38;5;222mauto\x1b[0m \x1b[2m│\x1b[0m \x1b[38;5;218m🌿 main\x1b[0m \x1b[2m│\x1b[0m \x1b[38;5;222m📁 proj\x1b[0m \x1b[2m│\x1b[0m \x1b[38;5;249m⏱ <1m\x1b[0m \x1b[2m│\x1b[0m \x1b[38;5;249mv1.2.3\x1b[0m",
  );
  expect(h.run(payload, { NO_COLOR: "1" })).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h: 18% | 7d: 9% | auto | main | proj | <1m | v1.2.3");
  expect(h.run(payload, { NO_COLOR: "", TERM: "dumb" })).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h: 18% | 7d: 9% | auto | main | proj | <1m | v1.2.3");
  expect(h.run(payload, { NO_COLOR: "", COLUMNS: "40" })).toBe("5h: \x1b[32m18%\x1b[0m");
  mkdirSync(join(h.env["XDG_CONFIG_HOME"]!, "kimi-dashboard"), { recursive: true });
  writeFileSync(join(h.env["XDG_CONFIG_HOME"]!, "kimi-dashboard", "config.toml"), 'segments = ["5h", "ctx", "cwd"]\nbarWidth = 4\nascii = true\n');
  expect(h.run()).toBe("5h: 18% | #--- 32% | proj");
});

test("an explicit config object bypasses the config file", () => {
  const h = harness();
  writeCache(h.cacheFile, cacheWith({}));
  const line = statusline({ stdin: payload, env: h.env, home: "/Users/you", now: NOW, config: { ...DEFAULT_CONFIG, segments: ["7d"] }, spawnRefresh: () => {} });
  expect(line).toBe("7d: 9%");
});

const kimiConfigFixture = new URL("./fixtures/kimi-config.toml", import.meta.url);

function withKimiConfig(h: Harness): Harness {
  copyFileSync(kimiConfigFixture, join(h.env["KIMI_CODE_HOME"]!, "config.toml"));
  return h;
}

test("quota segments are hidden and no refresh is spawned while a non-Kimi provider is active", () => {
  const h = withKimiConfig(harness());
  writeCache(h.cacheFile, cacheWith({ fetchedAt: NOW - 660_000, attemptedAt: NOW - 660_000 }));
  const deepseek = JSON.stringify({ ...JSON.parse(payload), model: "DeepSeek V4 Flash" });
  expect(h.run(deepseek)).toBe("DeepSeek V4 Flash | ###------- 32% | 62.5k/195k | auto | main | proj | <1m | v1.2.3");
  expect(h.spawned()).toBe(0);
  const k3 = JSON.stringify({ ...JSON.parse(payload), model: "K3" });
  expect(h.run(k3)).toBe("K3 | ###------- 32% | 62.5k/195k | ~5h: 18% | ~7d: 9% | auto | main | proj | <1m | v1.2.3");
  expect(h.spawned()).toBe(1);
});

test("quotaWhenNotKimi = show keeps the quota for other providers; an unknown model or missing config also shows it", () => {
  const h = withKimiConfig(harness());
  writeCache(h.cacheFile, cacheWith({}));
  const deepseek = JSON.stringify({ ...JSON.parse(payload), model: "DeepSeek V4 Flash" });
  mkdirSync(join(h.env["XDG_CONFIG_HOME"]!, "kimi-dashboard"), { recursive: true });
  writeFileSync(join(h.env["XDG_CONFIG_HOME"]!, "kimi-dashboard", "config.toml"), 'quotaWhenNotKimi = "show"\n');
  expect(h.run(deepseek)).toBe("DeepSeek V4 Flash | ###------- 32% | 62.5k/195k | 5h: 18% | 7d: 9% | auto | main | proj | <1m | v1.2.3");
  const unknown = JSON.stringify({ ...JSON.parse(payload), model: "Mystery" });
  expect(h.run(unknown)).toBe("Mystery | ###------- 32% | 62.5k/195k | 5h: 18% | 7d: 9% | auto | main | proj | <1m | v1.2.3");
  const noConfig = harness();
  writeCache(noConfig.cacheFile, cacheWith({}));
  expect(noConfig.run(deepseek)).toBe("DeepSeek V4 Flash | ###------- 32% | 62.5k/195k | 5h: 18% | 7d: 9% | auto | main | proj | <1m | v1.2.3");
});

test("session duration is measured from the first time a sessionId is seen, per cache dir", () => {
  const h = harness();
  expect(h.run()).toContain("| <1m |");
  const at = (now: number, stdin = payload) => statusline({ stdin, env: h.env, home: "/Users/you", now, spawnRefresh: () => {} });
  expect(at(NOW + 65 * 60_000)).toContain("| 1h5m |");
  expect(at(NOW + 65 * 60_000, JSON.stringify({ ...JSON.parse(payload), sessionId: "session_y" }))).toContain("| <1m |");
  expect(at(NOW + 90 * 60_000)).toContain("| 1h30m |");
});

test("the expired hint follows the OS locale unless lang is pinned in the config", () => {
  const h = harness();
  writeCache(h.cacheFile, cacheWith({ ok: false, errorCode: "expired", error: "x", summary: null, limits: [], fetchedAt: 0 }));
  expect(h.run(payload, { LANG: "en_US.UTF-8" })).toContain("quota unavailable · keep using kimi-code to refresh the login");
  expect(h.run(payload, { LANG: "zh_CN.UTF-8" })).toContain("额度不可用 · 请在 kimi-code 中继续使用以刷新凭证");
  expect(h.run(payload, {})).toContain("quota unavailable");
  mkdirSync(join(h.env["XDG_CONFIG_HOME"]!, "kimi-dashboard"), { recursive: true });
  writeFileSync(join(h.env["XDG_CONFIG_HOME"]!, "kimi-dashboard", "config.toml"), 'lang = "zh"\n');
  expect(h.run(payload, { LANG: "en_US.UTF-8" })).toContain("额度不可用");
});
