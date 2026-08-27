/**
 * `kimi-dashboard config`: show or edit the display configuration without
 * hand-editing TOML. Presets pick a segment list; `key=value` pairs set
 * individual keys. Invalid input is rejected as a whole and nothing is written.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { configPath, DEFAULT_CONFIG, loadConfig, type DashboardConfig, type SegmentId } from "./config.js";
import { previewLine, type CommandContext } from "./preview.js";
import { colorDepth, columnsFrom } from "./statusline.js";

/** Display order for messages and docs (same as the full default). */
export const SEGMENT_ORDER: readonly SegmentId[] = DEFAULT_CONFIG.segments;

export const PRESETS: Record<"compact" | "full" | "quota", SegmentId[]> = {
  compact: ["model", "ctx", "tokens", "5h", "7d"],
  full: [...DEFAULT_CONFIG.segments],
  quota: ["5h", "7d", "booster", "spend", "mode", "git"],
};

const KEYS = ["segments", "quotaStyle", "separator", "showReset", "icons", "barWidth", "ascii", "quotaWhenNotKimi", "refreshIntervalMs", "staleAfterMs", "lang"] as const;
const ENUMS: Record<string, readonly string[]> = {
  quotaStyle: ["text", "bar"],
  separator: ["pipe", "dot", "arrow", "space"],
  quotaWhenNotKimi: ["hide", "show"],
  lang: ["auto", "zh", "en"],
};

export type ApplyResult = { ok: true; config: DashboardConfig } | { ok: false; error: string };

/** Apply `key=value` assignments to a config; the first problem aborts the whole batch. */
export function applyAssignments(base: DashboardConfig, assignments: string[]): ApplyResult {
  const next: DashboardConfig = { ...base, segments: [...base.segments] };
  for (const raw of assignments) {
    const eq = raw.indexOf("=");
    if (eq <= 0) return { ok: false, error: `expected key=value (got "${raw}")` };
    const key = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (!(KEYS as readonly string[]).includes(key)) return { ok: false, error: `unknown key "${key}" (available: ${KEYS.join(" ")})` };
    switch (key) {
      case "segments": {
        const ids = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
        const known = new Set<string>(SEGMENT_ORDER);
        for (const id of ids) if (!known.has(id)) return { ok: false, error: `unknown segment "${id}" (available: ${SEGMENT_ORDER.join(" ")})` };
        if (ids.length === 0) return { ok: false, error: "segments must list at least one segment" };
        next.segments = ids as SegmentId[];
        break;
      }
      case "quotaStyle":
      case "separator":
      case "quotaWhenNotKimi":
      case "lang": {
        const allowed = ENUMS[key] ?? [];
        if (!allowed.includes(value)) return { ok: false, error: `${key} must be one of: ${allowed.join(", ")} (got "${value}")` };
        (next as unknown as Record<string, unknown>)[key] = value;
        break;
      }
      case "showReset":
      case "icons":
      case "ascii": {
        if (value !== "true" && value !== "false") return { ok: false, error: `${key} must be true or false (got "${value}")` };
        next[key] = value === "true";
        break;
      }
      case "barWidth":
      case "refreshIntervalMs":
      case "staleAfterMs": {
        const n = Number(value);
        if (!/^\d+$/.test(value) || !(n > 0)) return { ok: false, error: `${key} must be a positive integer (got "${value}")` };
        next[key] = n;
        break;
      }
    }
  }
  return { ok: true, config: next };
}

function line(key: string, value: string, comment?: string): string {
  const head = `${key} = ${value}`;
  return comment ? `${head.padEnd(31)}# ${comment}` : head;
}

/** Full, commented config.toml; every key explicit so users can see what to tweak. */
export function serializeConfig(config: DashboardConfig): string {
  return [
    "# kimi-dashboard — 底栏配置 / footer configuration",
    `# 可用段位 / segments: ${SEGMENT_ORDER.join(" ")}`,
    line("segments", `[${config.segments.map((id) => JSON.stringify(id)).join(", ")}]`),
    line("quotaStyle", JSON.stringify(config.quotaStyle), "text | bar"),
    line("separator", JSON.stringify(config.separator), "pipe | dot | arrow | space"),
    line("showReset", String(config.showReset), "(32m) 重置倒计时 / reset countdown"),
    line("icons", String(config.icons), "◆ 🌿 📁 ⚡ 💰 ⏱"),
    line("barWidth", String(config.barWidth)),
    line("ascii", String(config.ascii)),
    line("quotaWhenNotKimi", JSON.stringify(config.quotaWhenNotKimi), "hide | show"),
    line("refreshIntervalMs", String(config.refreshIntervalMs)),
    line("staleAfterMs", String(config.staleAfterMs)),
    line("lang", JSON.stringify(config.lang), "auto | zh | en — footer hint language (auto = $LANG)"),
    "",
  ].join("\n");
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/** Exit 0 and print the effective config + a preview line; exit 1 on invalid input (file untouched). */
export function runConfig(args: string[], ctx: CommandContext): number {
  const path = configPath(ctx.env, ctx.home);
  const current = loadConfig(path);
  const preset = flagValue(args, "--preset");
  const assignments = args.filter((a, i) => a !== "--preset" && !(i > 0 && args[i - 1] === "--preset"));

  let next = current;
  if (preset !== undefined) {
    const segments = (PRESETS as Record<string, SegmentId[] | undefined>)[preset];
    if (!segments) {
      process.stderr.write(`unknown preset "${preset}" (available: ${Object.keys(PRESETS).join(", ")})\n`);
      return 1;
    }
    next = { ...next, segments: [...segments] };
  }
  const applied = applyAssignments(next, assignments);
  if (!applied.ok) {
    process.stderr.write(`${applied.error}\n`);
    return 1;
  }
  next = applied.config;

  const changed = preset !== undefined || assignments.length > 0;
  const text = serializeConfig(next);
  if (changed) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
    process.stdout.write(`wrote ${path}\n`);
  } else {
    process.stdout.write(`${path}${existsSync(path) ? "" : " (absent, using defaults)"}\n`);
  }
  process.stdout.write(text);
  const colors = process.stdout.isTTY ? colorDepth(ctx.env) : 0;
  process.stdout.write(`preview: ${previewLine(colors === 0 ? { ...next, ascii: true } : next, ctx, { colors, columns: columnsFrom(ctx.env) })}\n`);
  return 0;
}

/** Read the raw file for `doctor`-style display; null when absent. */
export function readConfigText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
