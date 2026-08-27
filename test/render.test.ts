import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type SegmentId } from "../src/config.js";
import { formatTokenCount, render, type RenderState } from "../src/render.js";
import type { QuotaData } from "../src/types.js";

const quota: QuotaData = {
  summary: { name: "weekly", window: { duration: 1, unit: "week" }, used: 90, limit: 1000, resetAt: "2026-08-03T05:20:51Z" },
  limits: [{ name: "5h", window: { duration: 5, unit: "hour" }, used: 18, limit: 100, resetAt: "2026-08-01T09:00:00Z" }],
  extraUsage: null,
};
/** 32 minutes before the 5h reset, 1d20h before the weekly one. */
const NOW = Date.parse("2026-08-01T08:28:00Z");
const data = { kind: "data", stale: false, data: quota } as const;
const wallet = { balanceCents: 4200, totalCents: 10000, monthlyChargeLimitEnabled: true, monthlyChargeLimitCents: 20000, monthlyUsedCents: 5800, currency: "CNY" };

function state(overrides: Partial<RenderState> = {}): RenderState {
  return {
    payload: { model: "kimi-k2", cwd: "/Users/you/proj", gitBranch: "main", contextUsage: 0.32, contextTokens: 64000, maxContextTokens: 200000 },
    quota: { kind: "none" },
    config: DEFAULT_CONFIG,
    columns: 200,
    colors: 0,
    now: NOW,
    home: "/Users/you",
    ...overrides,
  };
}

const seg = (...segments: SegmentId[]) => ({ ...DEFAULT_CONFIG, segments });

test("default layout mirrors claude-dashboard: model, context bar, tokens, then the quota windows", () => {
  expect(render(state({ quota: data }))).toBe("◆ kimi-k2 │ ███░░░░░░░ 32% │ 62.5k/195k │ 5h: 18% (32m) │ 7d: 9% (1d20h) │ 🌿 main │ 📁 proj");
});

test("without any cached quota the windows show -- and everything else still renders", () => {
  expect(render(state())).toBe("◆ kimi-k2 │ ███░░░░░░░ 32% │ 62.5k/195k │ 5h: -- │ 7d: -- │ 🌿 main │ 📁 proj");
});

test("stale quota keeps the numbers but marks them with a ~ prefix", () => {
  expect(render(state({ quota: { ...data, stale: true } }))).toBe("◆ kimi-k2 │ ███░░░░░░░ 32% │ 62.5k/195k │ ~5h: 18% (32m) │ ~7d: 9% (1d20h) │ 🌿 main │ 📁 proj");
});

test("quotaStyle = bar restores the progress-bar rendering for the quota windows", () => {
  const cfg = { ...seg("5h", "7d"), quotaStyle: "bar" as const };
  expect(render(state({ quota: data, config: cfg }))).toBe("5h ██░░░░░░░░ 18% (32m) │ 7d █░░░░░░░░░ 9% (1d20h)");
  expect(render(state({ quota: { ...data, stale: true }, config: cfg }))).toBe("~5h ██░░░░░░░░ 18% (32m) │ ~7d █░░░░░░░░░ 9% (1d20h)");
  expect(render(state({ config: cfg }))).toBe("5h -- │ 7d --");
});

test("context bar and token counts match the host's own line-2 readout: ceiled percent, 1024-based k/M", () => {
  const cfg = seg("ctx", "tokens", "model");
  expect(render(state({ config: cfg }))).toBe("███░░░░░░░ 32% │ 62.5k/195k │ ◆ kimi-k2");
  expect(render(state({ config: cfg, payload: { model: "kimi-k2", contextTokens: 150000, maxContextTokens: 200000 } }))).toBe("████████░░ 75% │ 146k/195k │ ◆ kimi-k2");
  // 23700/1000000 = 2.37% → the host shows 3% (ceil) and 977k (1000000/1024); so do we
  expect(render(state({ config: cfg, payload: { model: "kimi-k2", contextUsage: 0.0237, contextTokens: 23700, maxContextTokens: 1000000 } }))).toBe("░░░░░░░░░░ 3% │ 23.1k/977k │ ◆ kimi-k2");
  expect(render(state({ config: cfg, payload: { model: "kimi-k2", contextUsage: 0.004 } }))).toBe("░░░░░░░░░░ 1% │ ◆ kimi-k2");
  expect(render(state({ config: cfg, payload: { model: "kimi-k2" } }))).toBe("◆ kimi-k2");
  expect(formatTokenCount(999)).toBe("999");
  expect(formatTokenCount(1024)).toBe("1k");
  expect(formatTokenCount(1536)).toBe("1.5k");
  expect(formatTokenCount(12345)).toBe("12.1k");
  expect(formatTokenCount(150000)).toBe("146k");
  expect(formatTokenCount(1048576)).toBe("1M");
  expect(formatTokenCount(1234567)).toBe("1.2M");
  expect(formatTokenCount(12_345_678)).toBe("11.8M");
  expect(formatTokenCount(-5)).toBe("0");
});

test("time-to-reset formats as <1m / 32m / 3h / 3h5m / 2d15h, disappears when past, unknown, or disabled", () => {
  const at = (offsetMs: number) => ({ ...data, data: { ...quota, limits: [{ ...quota.limits[0]!, resetAt: new Date(NOW + offsetMs).toISOString() }] } });
  const cfg = seg("5h");
  const line = (offsetMs: number) => render(state({ quota: at(offsetMs), config: cfg }));
  expect(line(45_000)).toBe("5h: 18% (<1m)");
  expect(line(32 * 60_000)).toBe("5h: 18% (32m)");
  expect(line(3 * 3_600_000)).toBe("5h: 18% (3h)");
  expect(line(3 * 3_600_000 + 5 * 60_000)).toBe("5h: 18% (3h5m)");
  expect(line(2 * 86_400_000 + 15 * 3_600_000)).toBe("5h: 18% (2d15h)");
  expect(line(-1)).toBe("5h: 18%");
  const invalid = { ...data, data: { ...quota, limits: [{ ...quota.limits[0]!, resetAt: "soon" }] } };
  expect(render(state({ quota: invalid, config: cfg }))).toBe("5h: 18%");
  expect(render(state({ quota: data, config: { ...cfg, showReset: false } }))).toBe("5h: 18%");
});

test("percentages use the 256-colour palette by usage band, countdown in grey, separators dim; 16-colour terminals get basic codes", () => {
  const at = (used5h: number, usedWeekly: number): QuotaData => ({ ...quota, summary: { ...quota.summary!, used: usedWeekly }, limits: [{ ...quota.limits[0]!, used: used5h }] });
  const cfg = seg("5h", "7d");
  const line = (used5h: number, usedWeekly: number, colors: 16 | 256) => render(state({ colors, quota: { ...data, data: at(used5h, usedWeekly) }, config: cfg }));
  expect(line(18, 600, 256)).toBe("5h: \x1b[38;5;151m18%\x1b[0m \x1b[38;5;249m(32m)\x1b[0m \x1b[2m│\x1b[0m 7d: \x1b[38;5;222m60%\x1b[0m \x1b[38;5;249m(1d20h)\x1b[0m");
  expect(line(85, 860, 256)).toBe("5h: \x1b[38;5;222m85%\x1b[0m \x1b[38;5;249m(32m)\x1b[0m \x1b[2m│\x1b[0m 7d: \x1b[38;5;210m86%\x1b[0m \x1b[38;5;249m(1d20h)\x1b[0m");
  expect(line(18, 860, 16)).toBe("5h: \x1b[32m18%\x1b[0m \x1b[90m(32m)\x1b[0m \x1b[2m│\x1b[0m 7d: \x1b[31m86%\x1b[0m \x1b[90m(1d20h)\x1b[0m");
  expect(render(state({ colors: 256, config: seg("ctx") }))).toBe("\x1b[38;5;151m███░░░░░░░ 32%\x1b[0m");
});

test("decoration segments carry icons and colours: model cyan, git pink, cwd yellow, booster yellow", () => {
  const cfg = seg("booster", "model", "git", "cwd");
  const withWallet = { ...data, data: { ...quota, extraUsage: wallet } };
  expect(render(state({ quota: withWallet, config: cfg, colors: 256 }))).toBe(
    "\x1b[38;5;222m⚡ ¥42.00\x1b[0m \x1b[2m│\x1b[0m \x1b[38;5;117m◆ kimi-k2\x1b[0m \x1b[2m│\x1b[0m \x1b[38;5;218m🌿 main\x1b[0m \x1b[2m│\x1b[0m \x1b[38;5;222m📁 proj\x1b[0m",
  );
  expect(render(state({ quota: withWallet, config: { ...cfg, icons: false } }))).toBe("¥42.00 │ kimi-k2 │ main │ proj");
});

test("mode mirrors the host footer: auto/yolo bold yellow, plan bold blue, nothing in the default mode", () => {
  const cfg = seg("mode", "model");
  expect(render(state({ config: cfg, payload: { model: "K3", permissionMode: "auto" } }))).toBe("auto │ ◆ K3");
  expect(render(state({ config: cfg, payload: { model: "K3", permissionMode: "yolo", planMode: true } }))).toBe("yolo plan │ ◆ K3");
  expect(render(state({ config: cfg, payload: { model: "K3", permissionMode: "default", planMode: false } }))).toBe("◆ K3");
  expect(render(state({ config: cfg, colors: 16, payload: { model: "K3", permissionMode: "auto", planMode: true } }))).toBe(
    "\x1b[1;33mauto\x1b[0m \x1b[1;34mplan\x1b[0m \x1b[2m│\x1b[0m \x1b[34m◆ K3\x1b[0m",
  );
  expect(render(state({ config: cfg, colors: 256, payload: { model: "K3", permissionMode: "yolo" } }))).toBe("\x1b[1;38;5;222myolo\x1b[0m \x1b[2m│\x1b[0m \x1b[38;5;117m◆ K3\x1b[0m");
});

test("missing credentials collapse the quota segments into a single 'no auth' marker; expired shows the hint", () => {
  expect(render(state({ quota: { kind: "no-auth" } }))).toBe("◆ kimi-k2 │ ███░░░░░░░ 32% │ 62.5k/195k │ 5h/7d no auth │ 🌿 main │ 📁 proj");
  expect(render(state({ quota: { kind: "no-auth" }, config: seg("5h", "model") }))).toBe("5h no auth │ ◆ kimi-k2");
  expect(render(state({ quota: { kind: "expired" }, config: seg("5h", "7d", "model", "git") }))).toBe("额度不可用 · 请在 kimi-code 中继续使用以刷新凭证 │ ◆ kimi-k2 │ 🌿 main");
  expect(render(state({ quota: { kind: "expired" }, config: seg("5h", "7d", "model", "git"), lang: "en" }))).toBe("quota unavailable · keep using kimi-code to refresh the login │ ◆ kimi-k2 │ 🌿 main");
});

test("booster balance appears only when the wallet is enabled, with a currency symbol when known", () => {
  expect(render(state({ quota: { ...data, data: { ...quota, extraUsage: wallet } } }))).toBe(
    "◆ kimi-k2 │ ███░░░░░░░ 32% │ 62.5k/195k │ 5h: 18% (32m) │ 7d: 9% (1d20h) │ ⚡ ¥42.00 │ 💰 ¥58.00/¥200.00 │ 🌿 main │ 📁 proj",
  );
  expect(render(state({ quota: { ...data, data: { ...quota, extraUsage: { ...wallet, currency: "USD", balanceCents: 5, monthlyChargeLimitEnabled: false } } } }))).toContain("⚡ $0.05");
  expect(render(state({ quota: { ...data, data: { ...quota, extraUsage: { ...wallet, currency: "EUR", balanceCents: 123456 } } } }))).toContain("⚡ EUR 1234.56");
  expect(render(state({ quota: { ...data, data: { ...quota, extraUsage: { ...wallet, monthlyChargeLimitEnabled: false, balanceCents: 0 } } } }))).toBe(
    "◆ kimi-k2 │ ███░░░░░░░ 32% │ 62.5k/195k │ 5h: 18% (32m) │ 7d: 9% (1d20h) │ 🌿 main │ 📁 proj",
  );
});

test("segments drop from the lowest priority up until the line fits; under 60 columns only 5h survives", () => {
  // 13 + 3 + 14 + 3 + 9 + 3 + 7 (+ 3 + 7 for cwd) cells
  const withCwd = state({ quota: data, config: seg("5h", "7d", "model", "git", "cwd") });
  expect(render({ ...withCwd, columns: 120 })).toBe("5h: 18% (32m) │ 7d: 9% (1d20h) │ ◆ kimi-k2 │ 🌿 main │ 📁 proj");
  expect(render({ ...withCwd, columns: 61 })).toBe("5h: 18% (32m) │ 7d: 9% (1d20h) │ ◆ kimi-k2 │ 🌿 main");
  expect(render({ ...withCwd, columns: 59 })).toBe("5h: 18% (32m)");
  expect(render({ ...withCwd, columns: 5 })).toBe("");
  // priority decides what is dropped; configured order decides where things sit
  const reordered = state({ quota: data, config: seg("model", "5h", "git", "7d") });
  expect(render({ ...reordered, columns: 60 })).toBe("◆ kimi-k2 │ 5h: 18% (32m) │ 🌿 main │ 7d: 9% (1d20h)");
  const longBranch = { ...reordered, payload: { ...reordered.payload, gitBranch: "feature/very-long-branch-name-here" } };
  expect(render({ ...longBranch, columns: 60 })).toBe("◆ kimi-k2 │ 5h: 18% (32m) │ 7d: 9% (1d20h)");
  // the default layout keeps quota over context/model/tokens when squeezed
  expect(render(state({ quota: data, columns: 62 }))).toBe("◆ kimi-k2 │ ███░░░░░░░ 32% │ 5h: 18% (32m) │ 7d: 9% (1d20h)");
  // ANSI escapes take no cells; CJK glyphs take two: hint is 48 cells, with model (60) fits in 60
  expect(render(state({ quota: data, colors: 256, columns: 62 }))).toContain("7d:");
  expect(render(state({ quota: { kind: "expired" }, columns: 60, config: seg("5h", "7d", "model", "git") }))).toBe("额度不可用 · 请在 kimi-code 中继续使用以刷新凭证 │ ◆ kimi-k2");
  expect(render(state({ quota: { kind: "expired" }, columns: 59, config: seg("5h", "7d", "model", "git") }))).toBe("额度不可用 · 请在 kimi-code 中继续使用以刷新凭证");
});

test("ascii mode: # and - bars, plain | separators, no icons", () => {
  expect(render(state({ quota: data, config: { ...DEFAULT_CONFIG, ascii: true } }))).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h: 18% (32m) | 7d: 9% (1d20h) | main | proj");
  expect(render(state({ quota: data, config: { ...seg("5h", "7d"), ascii: true, quotaStyle: "bar" } }))).toBe("5h ##-------- 18% (32m) | 7d #--------- 9% (1d20h)");
});

test("separator styles: dot, arrow, space", () => {
  const cfg = (separator: "dot" | "arrow" | "space") => ({ ...seg("model", "git"), separator });
  expect(render(state({ config: cfg("dot") }))).toBe("◆ kimi-k2 · 🌿 main");
  expect(render(state({ config: cfg("arrow") }))).toBe("◆ kimi-k2 › 🌿 main");
  expect(render(state({ config: cfg("space") }))).toBe("◆ kimi-k2   🌿 main");
});

test("cwd shows the directory name, ~ for home", () => {
  const cfg = seg("cwd");
  expect(render(state({ config: cfg }))).toBe("📁 proj");
  expect(render(state({ config: cfg, payload: { cwd: "/srv/app" } }))).toBe("📁 app");
  expect(render(state({ config: cfg, payload: { cwd: "/Users/you" } }))).toBe("📁 ~");
  expect(render(state({ config: cfg, payload: {} }))).toBe("");
});

test("odd inputs degrade instead of throwing", () => {
  const zeroLimit: QuotaData = { ...quota, limits: [{ ...quota.limits[0]!, limit: 0 }] };
  expect(render(state({ quota: { ...data, data: zeroLimit }, config: seg("5h", "7d") }))).toBe("5h: -- │ 7d: 9% (1d20h)");
  const over: QuotaData = { ...quota, limits: [{ ...quota.limits[0]!, used: 250 }] };
  expect(render(state({ quota: { ...data, data: over }, colors: 16, config: seg("5h") }))).toBe("5h: \x1b[31m100%\x1b[0m \x1b[90m(32m)\x1b[0m");
  const noLimits: QuotaData = { ...quota, limits: [] };
  expect(render(state({ quota: { ...data, data: noLimits }, config: seg("5h", "7d") }))).toBe("5h: -- │ 7d: 9% (1d20h)");
  expect(render(state({ payload: {} }))).toBe("5h: -- │ 7d: --");
  expect(render(state({ payload: { contextUsage: Number.NaN, model: "m" }, config: seg("ctx", "tokens", "model") }))).toBe("◆ m");
  expect(render(state({ payload: { contextTokens: 5, maxContextTokens: 0, model: "m" }, config: seg("ctx", "tokens", "model") }))).toBe("◆ m");
  expect(render(state({ config: { ...seg("5h", "7d"), quotaStyle: "bar", barWidth: -3 }, quota: data }))).toBe("5h 18% (32m) │ 7d 9% (1d20h)");
  expect(render(state({ columns: Number.NaN }))).toBe("◆ kimi-k2 │ ███░░░░░░░ 32% │ 62.5k/195k │ 5h: -- │ 7d: -- │ 🌿 main │ 📁 proj");
});

const FULL_PAYLOAD = { model: "kimi-k2", cwd: "/Users/you/proj", gitBranch: "main", permissionMode: "auto", contextUsage: 0.32, contextTokens: 64000, maxContextTokens: 200000, sessionId: "session_x", version: "0.39.0" };

test("the full default line: model, context, tokens, quota, booster, spend, mode, git, cwd, session, version — trimmed from the tail", () => {
  const full = state({ quota: { ...data, data: { ...quota, extraUsage: wallet } }, payload: FULL_PAYLOAD, sessionStartedAt: NOW - 65 * 60_000 });
  expect(render(full)).toBe(
    "◆ kimi-k2 │ ███░░░░░░░ 32% │ 62.5k/195k │ 5h: 18% (32m) │ 7d: 9% (1d20h) │ ⚡ ¥42.00 │ 💰 ¥58.00/¥200.00 │ auto │ 🌿 main │ 📁 proj │ ⏱ 1h5m │ v0.39.0",
  );
  expect(render({ ...full, columns: 140 })).toBe(
    "◆ kimi-k2 │ ███░░░░░░░ 32% │ 62.5k/195k │ 5h: 18% (32m) │ 7d: 9% (1d20h) │ ⚡ ¥42.00 │ 💰 ¥58.00/¥200.00 │ auto │ 🌿 main │ 📁 proj │ ⏱ 1h5m",
  );
  // 150 cells in total; version (10 incl. separator) then session (9) go first
  expect(render({ ...full, columns: 131 })).toBe(
    "◆ kimi-k2 │ ███░░░░░░░ 32% │ 62.5k/195k │ 5h: 18% (32m) │ 7d: 9% (1d20h) │ ⚡ ¥42.00 │ 💰 ¥58.00/¥200.00 │ auto │ 🌿 main │ 📁 proj",
  );
});

test("spend shows the booster's monthly charge used/limit, coloured by how much of the limit is gone", () => {
  const cfg = seg("spend");
  const withSpend = (monthlyUsedCents: number, enabled = true) => ({ ...data, data: { ...quota, extraUsage: { ...wallet, monthlyUsedCents, monthlyChargeLimitEnabled: enabled } } });
  expect(render(state({ quota: withSpend(5800), config: cfg }))).toBe("💰 ¥58.00/¥200.00");
  expect(render(state({ quota: withSpend(5800), config: cfg, colors: 256 }))).toBe("\x1b[38;5;151m💰 ¥58.00/¥200.00\x1b[0m");
  expect(render(state({ quota: withSpend(12000), config: cfg, colors: 256 }))).toBe("\x1b[38;5;222m💰 ¥120.00/¥200.00\x1b[0m");
  expect(render(state({ quota: withSpend(17500), config: cfg, colors: 256 }))).toBe("\x1b[38;5;210m💰 ¥175.00/¥200.00\x1b[0m");
  expect(render(state({ quota: withSpend(5800, false), config: cfg }))).toBe("");
  expect(render(state({ quota: data, config: cfg }))).toBe("");
  expect(render(state({ quota: { kind: "no-auth" }, config: cfg }))).toBe("");
  expect(render(state({ quota: withSpend(5800), config: { ...cfg, icons: false } }))).toBe("¥58.00/¥200.00");
});

test("session shows how long this kimi-code session has been running", () => {
  const cfg = seg("session");
  expect(render(state({ config: cfg, sessionStartedAt: NOW - 30_000 }))).toBe("⏱ <1m");
  expect(render(state({ config: cfg, sessionStartedAt: NOW - 65 * 60_000 }))).toBe("⏱ 1h5m");
  expect(render(state({ config: cfg, sessionStartedAt: NOW - (2 * 86_400_000 + 3 * 3_600_000) }))).toBe("⏱ 2d3h");
  expect(render(state({ config: cfg, sessionStartedAt: NOW + 60_000 }))).toBe("⏱ <1m");
  expect(render(state({ config: cfg }))).toBe("");
  expect(render(state({ config: cfg, colors: 256, sessionStartedAt: NOW - 5 * 60_000 }))).toBe("\x1b[38;5;249m⏱ 5m\x1b[0m");
  expect(render(state({ config: { ...cfg, icons: false }, sessionStartedAt: NOW - 5 * 60_000 }))).toBe("5m");
});

test("version shows the host version in grey", () => {
  const cfg = seg("version");
  expect(render(state({ config: cfg, payload: { version: "0.39.0" } }))).toBe("v0.39.0");
  expect(render(state({ config: cfg, payload: { version: "v0.39.0" }, colors: 16 }))).toBe("\x1b[90mv0.39.0\x1b[0m");
  expect(render(state({ config: cfg, payload: {} }))).toBe("");
});
