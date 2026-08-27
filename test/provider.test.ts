import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { modelProviderKind } from "../src/provider.js";

const config = readFileSync(new URL("./fixtures/kimi-config.toml", import.meta.url), "utf8");

test("the model label kimi-code puts in the payload resolves to its provider kind", () => {
  expect(modelProviderKind(config, "K3")).toBe("kimi");
  expect(modelProviderKind(config, "kimi-code/k3-256k")).toBe("kimi");
  expect(modelProviderKind(config, "DeepSeek V4 Flash")).toBe("other");
  expect(modelProviderKind(config, "deepseek/deepseek-chat")).toBe("other");
  expect(modelProviderKind(config, "GPT 4.1")).toBe("other");
});

test("unknown labels or unreadable config resolve to unknown so the quota stays visible", () => {
  expect(modelProviderKind(config, "Mystery Model")).toBe("unknown");
  expect(modelProviderKind("", "K3")).toBe("unknown");
  expect(modelProviderKind("[models.\n= = broken", "K3")).toBe("unknown");
  // a managed provider whose [providers] block is missing still counts as kimi by name
  expect(modelProviderKind('[models."kimi-code/k3"]\nprovider = "managed:kimi-code"\ndisplay_name = "K3"\n', "K3")).toBe("kimi");
});
