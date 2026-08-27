import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";
import { PRESETS, applyAssignments, serializeConfig } from "../src/configure.js";
import { tempDir } from "./helpers.js";

test("serializeConfig writes every key explicitly and round-trips through the loader", () => {
  const text = serializeConfig({ ...DEFAULT_CONFIG, segments: ["5h", "7d", "git"], quotaStyle: "bar", separator: "dot", barWidth: 8, quotaWhenNotKimi: "show" });
  expect(text).toBe(
    [
      "# kimi-dashboard — 底栏配置 / footer configuration",
      "# 可用段位 / segments: model ctx tokens 5h 7d booster spend mode git cwd session version",
      'segments = ["5h", "7d", "git"]',
      'quotaStyle = "bar"             # text | bar',
      'separator = "dot"              # pipe | dot | arrow | space',
      "showReset = true               # (32m) 重置倒计时 / reset countdown",
      "icons = true                   # ◆ 🌿 📁 ⚡ 💰 ⏱",
      "barWidth = 8",
      "ascii = false",
      'quotaWhenNotKimi = "show"      # hide | show',
      "refreshIntervalMs = 120000",
      "staleAfterMs = 600000",
      'lang = "auto"                  # auto | zh | en — footer hint language (auto = $LANG)',
      "",
    ].join("\n"),
  );
  const path = join(tempDir(), "config.toml");
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(path, text);
  expect(loadConfig(path)).toEqual({ ...DEFAULT_CONFIG, segments: ["5h", "7d", "git"], quotaStyle: "bar", separator: "dot", barWidth: 8, quotaWhenNotKimi: "show" });
});

test("presets pick a segment list and keep everything else", () => {
  expect(PRESETS.compact).toEqual(["model", "ctx", "tokens", "5h", "7d"]);
  expect(PRESETS.full).toEqual(DEFAULT_CONFIG.segments);
  expect(PRESETS.quota).toEqual(["5h", "7d", "booster", "spend", "mode", "git"]);
});

test("key=value assignments are validated: unknown keys, segments or enum values are rejected as a whole", () => {
  const base = { ...DEFAULT_CONFIG };
  expect(applyAssignments(base, ["segments=5h,7d,git", "quotaStyle=bar", "separator=arrow", "showReset=false", "icons=false", "barWidth=6", "quotaWhenNotKimi=show", "refreshIntervalMs=60000"])).toEqual({
    ok: true,
    config: { ...base, segments: ["5h", "7d", "git"], quotaStyle: "bar", separator: "arrow", showReset: false, icons: false, barWidth: 6, quotaWhenNotKimi: "show", refreshIntervalMs: 60000 },
  });
  expect(applyAssignments(base, ["segments=5h,bogus"])).toEqual({ ok: false, error: 'unknown segment "bogus" (available: model ctx tokens 5h 7d booster spend mode git cwd session version)' });
  expect(applyAssignments(base, ["quotaStyle=nope"])).toEqual({ ok: false, error: 'quotaStyle must be one of: text, bar (got "nope")' });
  expect(applyAssignments(base, ["colour=red"])).toEqual({ ok: false, error: 'unknown key "colour" (available: segments quotaStyle separator showReset icons barWidth ascii quotaWhenNotKimi refreshIntervalMs staleAfterMs lang)' });
  expect(applyAssignments(base, ["lang=zh"])).toEqual({ ok: true, config: { ...base, lang: "zh" } });
  expect(applyAssignments(base, ["lang=fr"])).toEqual({ ok: false, error: 'lang must be one of: auto, zh, en (got "fr")' });
  expect(applyAssignments(base, ["barWidth=zero"])).toEqual({ ok: false, error: 'barWidth must be a positive integer (got "zero")' });
  expect(applyAssignments(base, ["segments"])).toEqual({ ok: false, error: 'expected key=value (got "segments")' });
});
