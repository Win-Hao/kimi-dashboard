import { configPath, loadConfig } from "./config.js";
import type { CommandContext } from "./preview.js";
import { refresh } from "./quota/refresh.js";

function intFlag(args: string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const n = Number.parseInt(args[index + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Optional resident mode (SPEC §3.1): refresh, sleep, repeat. Never installs itself anywhere. */
export async function runDaemon(args: string[], ctx: CommandContext): Promise<number> {
  const config = loadConfig(configPath(ctx.env, ctx.home));
  const intervalMs = intFlag(args, "--interval-ms") ?? config.refreshIntervalMs;
  const maxIterations = intFlag(args, "--max-iterations");
  const verbose = args.includes("--verbose");

  let stopped = false;
  let wake: (() => void) | null = null;
  const stop = () => {
    stopped = true;
    wake?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  for (let i = 0; !stopped && (maxIterations === undefined || i < maxIterations); i += 1) {
    const outcome = await refresh({ env: ctx.env, home: ctx.home });
    if (verbose) process.stdout.write(`${new Date().toISOString()} ${JSON.stringify(outcome)}\n`);
    if (stopped || (maxIterations !== undefined && i + 1 >= maxIterations)) break;
    // The timer must keep the event loop alive: an unref'd timer would let the process exit mid-sleep.
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, intervalMs);
    });
    wake = null;
  }
  return 0;
}
