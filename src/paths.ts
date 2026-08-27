import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export const DEFAULT_BASE_URL = "https://api.kimi.com/coding/v1";

/** kimi-code's data dir: KIMI_CODE_HOME, else ~/.kimi-code (mirrors kimi-code itself). */
export function kimiHome(env: NodeJS.ProcessEnv, home: string): string {
  const override = env["KIMI_CODE_HOME"]?.trim();
  return override && override.length > 0 ? override : join(home, ".kimi-code");
}

/** Managed API base: KIMI_CODE_BASE_URL wins, trailing slashes dropped. */
export function apiBaseUrl(env: NodeJS.ProcessEnv): string {
  const override = env["KIMI_CODE_BASE_URL"]?.trim();
  return (override && override.length > 0 ? override : DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** First PATH entry containing `name` (plus .cmd/.exe on Windows), or null. Pure fs, no spawn. */
export function findOnPath(env: NodeJS.ProcessEnv, name: string): string | null {
  const candidates = process.platform === "win32" ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const dir of (env["PATH"] ?? "").split(delimiter)) {
    if (dir.length === 0) continue;
    for (const candidate of candidates) {
      const full = join(dir, candidate);
      if (existsSync(full)) return full;
    }
  }
  return null;
}
