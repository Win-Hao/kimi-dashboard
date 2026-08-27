import { join } from "node:path";
import { DEFAULT_CONFIG, configPath, loadConfig, type DashboardConfig } from "./config.js";
import { render, type ColorDepth, type QuotaView } from "./render.js";
import { detectLang } from "./lang.js";
import { colorDepth, columnsFrom } from "./statusline.js";
import type { QuotaData } from "./types.js";

export interface CommandContext {
  env: NodeJS.ProcessEnv;
  home: string;
}

/** Sample quota so contributors can iterate on rendering without an account (SPEC §5). Resets are relative to now. */
export function sampleQuota(now: number, hot = false): QuotaData {
  const minutes = 60_000;
  return {
    summary: { name: "weekly", window: { duration: 1, unit: "week" }, used: hot ? 920 : 340, limit: 1000, resetAt: new Date(now + (44 * 60 + 30) * minutes).toISOString() },
    limits: [{ name: "5h", window: { duration: 5, unit: "hour" }, used: hot ? 85 : 18, limit: 100, resetAt: new Date(now + 32.5 * minutes).toISOString() }],
    extraUsage: { balanceCents: 4200, totalCents: 10000, monthlyChargeLimitEnabled: true, monthlyChargeLimitCents: 20000, monthlyUsedCents: hot ? 17500 : 5800, currency: "CNY" },
  };
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

/**
 * Flags: --stale --no-auth --expired --empty --hot (red/yellow bands) --not-kimi (quota hidden)
 *        --bar --ascii --ctx --width N --color (force ANSI even when piped) --no-color
 */
export interface PreviewOptions {
  colors: ColorDepth;
  columns: number;
  quota?: QuotaView;
  hot?: boolean;
  notKimi?: boolean;
}

/** One rendered sample line for a given config (used by `preview` and `config`). */
export function previewLine(config: DashboardConfig, ctx: CommandContext, opts: PreviewOptions): string {
  const now = Date.now();
  const hot = opts.hot === true;
  const contextTokens = hot ? 176000 : 64000;
  return render({
    payload: {
      model: opts.notKimi ? "DeepSeek V4 Flash" : "kimi-k2",
      cwd: join(ctx.home, "projects", "demo"),
      gitBranch: "main",
      permissionMode: "auto",
      contextUsage: contextTokens / 200000,
      contextTokens,
      maxContextTokens: 200000,
      sessionId: "session_demo",
      version: "0.39.0",
    },
    quota: opts.quota ?? { kind: "data", stale: false, data: sampleQuota(now, hot) },
    config,
    columns: opts.columns,
    colors: opts.colors,
    now,
    home: ctx.home,
    lang: detectLang(config.lang, ctx.env),
    sessionStartedAt: now - 65 * 60_000,
  });
}

/**
 * Flags: --stale --no-auth --expired --empty --hot (red/yellow bands) --not-kimi (quota hidden)
 *        --bar --ascii --ctx --width N --color (force ANSI even when piped) --no-color
 */
export function runPreview(args: string[], ctx: CommandContext): number {
  const base = loadConfig(configPath(ctx.env, ctx.home));
  const notKimi = args.includes("--not-kimi");
  let segments = args.includes("--ctx") && !base.segments.includes("ctx") ? [...base.segments, "ctx" as const] : base.segments;
  if (notKimi) segments = segments.filter((s) => s !== "5h" && s !== "7d" && s !== "booster" && s !== "spend");
  const config = { ...DEFAULT_CONFIG, ...base, segments, ascii: base.ascii || args.includes("--ascii"), quotaStyle: args.includes("--bar") ? ("bar" as const) : base.quotaStyle };
  const hot = args.includes("--hot");
  let quota: QuotaView | undefined;
  if (args.includes("--no-auth")) quota = { kind: "no-auth" };
  else if (args.includes("--expired")) quota = { kind: "expired" };
  else if (args.includes("--empty")) quota = { kind: "none" };
  else if (args.includes("--stale")) quota = { kind: "data", stale: true, data: sampleQuota(Date.now(), hot) };
  const width = Number.parseInt(flagValue(args, "--width") ?? "", 10);
  const colors = args.includes("--no-color") || (!process.stdout.isTTY && !args.includes("--color")) ? 0 : colorDepth(ctx.env);
  const line = previewLine(colors === 0 ? { ...config, ascii: true } : config, ctx, {
    colors,
    columns: Number.isFinite(width) && width > 0 ? width : (process.stdout.columns ?? columnsFrom(ctx.env)),
    hot,
    notKimi,
    ...(quota ? { quota } : {}),
  });
  process.stdout.write(`${line}\n`);
  return 0;
}
