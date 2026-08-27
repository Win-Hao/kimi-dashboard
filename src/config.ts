/** User configuration (SPEC §8). Everything is optional; defaults must work with no file at all. */

export const SEGMENT_IDS = ["5h", "7d", "booster", "spend", "mode", "model", "git", "cwd", "ctx", "tokens", "session", "version"] as const;
export type SegmentId = (typeof SEGMENT_IDS)[number];

export type QuotaWhenNotKimi = "hide" | "show";
export type SeparatorStyle = "pipe" | "space" | "dot" | "arrow";
/** `text` → `5h: 18% (32m)` (claude-dashboard style); `bar` → `5h ██░░░░░░░░ 18% (32m)`. */
export type QuotaStyle = "text" | "bar";

export interface DashboardConfig {
  segments: SegmentId[];
  refreshIntervalMs: number;
  staleAfterMs: number;
  ascii: boolean;
  barWidth: number;
  /** The 5h/7d/booster segments are Kimi-account data; hide them while another provider's model is active. */
  quotaWhenNotKimi: QuotaWhenNotKimi;
  /** Between segments: `│` (pipe), `·` (dot), `›` (arrow) or three spaces. */
  separator: SeparatorStyle;
  /** Append the time until each quota window resets, e.g. `(32m)`. */
  showReset: boolean;
  /** Glyphs in front of decoration segments (◆ model, 🌿 git, 📁 cwd, ⚡ booster, 💰 spend, ⏱ session). */
  icons: boolean;
  quotaStyle: QuotaStyle;
}

/**
 * Layout follows claude-dashboard's first line: model, context bar, tokens, then the
 * quota windows. `ctx` duplicates the host's footer line 2 on purpose — the user asked
 * for the bar to be context (this overrides SPEC §6.4's original default).
 */
export const DEFAULT_CONFIG: DashboardConfig = Object.freeze({
  segments: ["model", "ctx", "tokens", "5h", "7d", "booster", "spend", "mode", "git", "cwd", "session", "version"],
  refreshIntervalMs: 120_000,
  staleAfterMs: 600_000,
  ascii: false,
  barWidth: 10,
  quotaWhenNotKimi: "hide",
  separator: "pipe",
  showReset: true,
  icons: true,
  quotaStyle: "text",
}) as DashboardConfig;

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseToml, type TomlValue } from "./toml.js";

/** $XDG_CONFIG_HOME/kimi-dashboard/config.toml, default ~/.config/… */
export function configPath(env: NodeJS.ProcessEnv, home: string): string {
  const base = env["XDG_CONFIG_HOME"]?.trim();
  return join(base && base.length > 0 ? base : join(home, ".config"), "kimi-dashboard", "config.toml");
}

/** Missing or unreadable file → defaults. Never throws. */
export function loadConfig(path: string): DashboardConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  return { ...DEFAULT_CONFIG, ...parseConfigToml(text) };
}

/** Root-level keys of the config file, applied leniently (SPEC §8). */
export function parseConfigToml(text: string): Partial<DashboardConfig> {
  const out: Partial<DashboardConfig> = {};
  for (const [key, value] of Object.entries(parseToml(text).root)) applyKey(out, key, value);
  return out;
}

function applyKey(out: Partial<DashboardConfig>, key: string, value: TomlValue): void {
  switch (key) {
    case "segments": {
      if (!Array.isArray(value)) return;
      const known = new Set<string>(SEGMENT_IDS);
      const segments = value.filter((v): v is SegmentId => known.has(v));
      if (segments.length > 0) out.segments = segments;
      return;
    }
    case "refreshIntervalMs":
    case "staleAfterMs":
    case "barWidth": {
      if (typeof value !== "number" || value <= 0) return;
      out[key] = Math.floor(value);
      return;
    }
    case "ascii":
    case "showReset":
    case "icons":
      if (typeof value === "boolean") out[key] = value;
      return;
    case "separator":
      if (value === "pipe" || value === "space" || value === "dot" || value === "arrow") out.separator = value;
      return;
    case "quotaStyle":
      if (value === "text" || value === "bar") out.quotaStyle = value;
      return;
    case "quotaWhenNotKimi":
      if (value === "hide" || value === "show") out.quotaWhenNotKimi = value;
      return;
    default:
      return;
  }
}
