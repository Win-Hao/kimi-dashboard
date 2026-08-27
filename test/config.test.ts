import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, configPath, loadConfig } from "../src/config.js";
import { tempDir } from "./helpers.js";

test("no config file means the documented defaults", () => {
  expect(loadConfig(join(tempDir(), "missing.toml"))).toEqual({
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
  });
  expect(loadConfig(join(tempDir(), "missing.toml"))).toEqual(DEFAULT_CONFIG);
});

test("a config file overrides individual keys and unknown segments or wrong types are ignored", () => {
  const dir = tempDir();
  const path = join(dir, "config.toml");
  writeFileSync(
    path,
    [
      "# kimi-dashboard config",
      'segments = ["5h", "ctx", "bogus", "model"]  # ctx is opt-in',
      "refreshIntervalMs = 60000",
      "staleAfterMs = 'not a number'",
      "ascii = true",
      "barWidth = 6.9",
      'quotaWhenNotKimi = "show"',
      'separator = "dot"',
      "showReset = false",
      "icons = false",
      'quotaStyle = "bar"',
      'unknownKey = "whatever"',
      "",
    ].join("\n"),
  );
  expect(loadConfig(path)).toEqual({
    segments: ["5h", "ctx", "model"],
    refreshIntervalMs: 60_000,
    staleAfterMs: 600_000,
    ascii: true,
    barWidth: 6,
    quotaWhenNotKimi: "show",
    separator: "dot",
    showReset: false,
    icons: false,
    quotaStyle: "bar",
  });
  const bad = join(dir, "bad-enum.toml");
  writeFileSync(bad, 'quotaWhenNotKimi = "maybe"\n');
  expect(loadConfig(bad).quotaWhenNotKimi).toBe("hide");
});

test("hostile or malformed config degrades to defaults rather than crashing the status line", () => {
  const dir = tempDir();
  const garbage = join(dir, "garbage.toml");
  writeFileSync(garbage, "segments = [\nrefreshIntervalMs = -5\nbarWidth = 1000\nascii = \"yes\"\n[section]\n= = =\n");
  expect(loadConfig(garbage)).toEqual({ ...DEFAULT_CONFIG, barWidth: 1000 });
  const empty = join(dir, "empty.toml");
  writeFileSync(empty, "");
  expect(loadConfig(empty)).toEqual(DEFAULT_CONFIG);
  const emptySegments = join(dir, "empty-segments.toml");
  writeFileSync(emptySegments, "segments = []\n");
  expect(loadConfig(emptySegments)).toEqual(DEFAULT_CONFIG);
});

test("config lives under XDG_CONFIG_HOME, defaulting to ~/.config", () => {
  expect(configPath({ XDG_CONFIG_HOME: "/tmp/xdg-config" }, "/home/me")).toBe(join("/tmp/xdg-config", "kimi-dashboard", "config.toml"));
  expect(configPath({}, "/home/me")).toBe(join("/home/me", ".config", "kimi-dashboard", "config.toml"));
});
