import { expect, test } from "vitest";
import { planStatusLineCommand } from "../src/setup.js";

const DEFAULT_TUI = `# ~/.kimi-code/tui.toml
# Client preferences for kimi-code.

theme = "auto" # "auto" | "dark" | "light" | custom theme name

[editor]
command = "" # Empty uses $VISUAL / $EDITOR

[notifications]
enabled = true # true | false

# [status_line]
# Pick and order the built-in footer slots: mode, goal, model, tasks, cwd, git, tips
# items = ["mode","goal","model","tasks","cwd","git","tips"]
# Or render your own: a command whose first stdout line replaces footer line 1.
# command = "~/.kimi-code/statusline.sh"
`;

test("a stock tui.toml (status_line commented out) gets a new [status_line] section appended, everything else untouched", () => {
  const plan = planStatusLineCommand(DEFAULT_TUI, "kimi-dashboard statusline");
  expect(plan).toEqual({ kind: "write", text: `${DEFAULT_TUI}\n[status_line]\ncommand = "kimi-dashboard statusline"\n` });
});

test("an active [status_line] section with only items gets the command inserted, items preserved", () => {
  const text = 'theme = "dark"\n\n[status_line]\nitems = ["mode", "git"]\n\n[upgrade]\nauto_install = true\n';
  expect(planStatusLineCommand(text, "kimi-dashboard statusline")).toEqual({
    kind: "write",
    text: 'theme = "dark"\n\n[status_line]\ncommand = "kimi-dashboard statusline"\nitems = ["mode", "git"]\n\n[upgrade]\nauto_install = true\n',
  });
});

test("an existing different command is a conflict that must be confirmed; the same command is a no-op", () => {
  const text = '[status_line]\ncommand = "~/.kimi-code/statusline.sh" # mine\n';
  expect(planStatusLineCommand(text, "kimi-dashboard statusline")).toEqual({
    kind: "conflict",
    existing: "~/.kimi-code/statusline.sh",
    text: '[status_line]\ncommand = "kimi-dashboard statusline"\n',
  });
  expect(planStatusLineCommand('[status_line]\ncommand = "kimi-dashboard statusline"\n', "kimi-dashboard statusline")).toEqual({ kind: "unchanged" });
});

test("an empty or newline-less file still gets a well-formed section, and commands are TOML-escaped", () => {
  expect(planStatusLineCommand("", 'node "/p/a th/cli.js" statusline')).toEqual({ kind: "write", text: '[status_line]\ncommand = "node \\"/p/a th/cli.js\\" statusline"\n' });
  expect(planStatusLineCommand('theme = "auto"', "kimi-dashboard statusline")).toEqual({ kind: "write", text: 'theme = "auto"\n\n[status_line]\ncommand = "kimi-dashboard statusline"\n' });
});

test("a command that already runs kimi-dashboard is ours to update, not a conflict (npm link → plugin path)", () => {
  const plugin = 'node "/Users/me/.kimi-code/plugins/managed/kimi-dashboard/dist/cli.js" statusline';
  expect(planStatusLineCommand('[status_line]\ncommand = "kimi-dashboard statusline"\n', plugin)).toEqual({ kind: "write", text: `[status_line]\ncommand = ${JSON.stringify(plugin)}\n` });
  expect(planStatusLineCommand('[status_line]\ncommand = "node \\"/old/kimi-dashboard/dist/cli.js\\" statusline"\n', "kimi-dashboard statusline")).toEqual({
    kind: "write",
    text: '[status_line]\ncommand = "kimi-dashboard statusline"\n',
  });
  // anything else stays a conflict
  expect(planStatusLineCommand('[status_line]\ncommand = "my-dashboard statusline"\n', plugin).kind).toBe("conflict");
});
