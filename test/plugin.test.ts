import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Shape rules from kimi-code's plugin docs (kimi.plugin.json, ./-relative paths inside the plugin). */
test("the repo root is a valid kimi-code plugin: manifest, commands, hook and bundled cli", () => {
  const manifest = JSON.parse(readFileSync(join(root, "kimi.plugin.json"), "utf8")) as Record<string, unknown>;
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  expect(manifest["name"]).toBe("kimi-dashboard");
  expect(manifest["name"]).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
  expect(manifest["version"]).toBe(pkg.version);
  expect(manifest["commands"]).toBe("./commands/");
  for (const file of ["setup.md", "doctor.md", "preview.md"]) {
    const text = readFileSync(join(root, "commands", file), "utf8").replace(/\r\n/g, "\n");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toMatch(/^description: .+/m);
    expect(text).toContain("plugins/managed/kimi-dashboard/dist/cli.js");
  }
  const hooks = manifest["hooks"] as Array<{ event: string; command: string; timeout: number }>;
  expect(hooks).toEqual([{ event: "SessionStart", command: "node ./dist/cli.js setup --self --quiet", timeout: 5 }]);
  for (const forbidden of ["tools", "apps", "inject", "configFile"]) expect(manifest).not.toHaveProperty(forbidden);
  // the plugin is installed straight from the GitHub zip: the bundle must be committed and fresh
  expect(existsSync(join(root, "dist", "cli.js"))).toBe(true);
  expect(statSync(join(root, "dist", "cli.js")).size).toBeGreaterThan(10_000);
});
