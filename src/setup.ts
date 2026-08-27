import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findOnPath, kimiHome } from "./paths.js";

/**
 * `kimi-dashboard setup`: point kimi-code's footer at us by writing
 * `[status_line] command = "…"` into tui.toml (SPEC §5). Line-based so the
 * user's comments and other sections survive verbatim.
 */

export type SetupPlan =
  | { kind: "unchanged" }
  | { kind: "write"; text: string }
  | { kind: "conflict"; existing: string; text: string };

const SECTION_HEADER = /^\s*\[status_line\]\s*(#.*)?$/;
const ANY_HEADER = /^\s*\[/;
const COMMAND_LINE = /^\s*command\s*=\s*(.*)$/;

function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Unquote a TOML basic/literal string, tolerating a trailing comment. */
function tomlUnquote(raw: string): string {
  const trimmed = raw.trim();
  const basic = /^"((?:[^"\\]|\\.)*)"/.exec(trimmed);
  if (basic) return (basic[1] ?? "").replace(/\\(["\\])/g, "$1");
  const literal = /^'([^']*)'/.exec(trimmed);
  if (literal) return literal[1] ?? "";
  return trimmed.replace(/\s+#.*$/, "");
}

function isOurCommand(command: string): boolean {
  return /kimi-dashboard(\s|\/|\\|")/.test(command) && /\bstatusline\b/.test(command);
}

export function planStatusLineCommand(tomlText: string, command: string): SetupPlan {
  const lines = tomlText.split("\n");
  const commandLine = `command = ${tomlBasicString(command)}`;
  const headerIndex = lines.findIndex((line) => SECTION_HEADER.test(line));

  if (headerIndex === -1) {
    const body = tomlText.length === 0 || tomlText.endsWith("\n") ? tomlText : `${tomlText}\n`;
    const gap = body.length === 0 ? "" : "\n";
    return { kind: "write", text: `${body}${gap}[status_line]\n${commandLine}\n` };
  }

  let sectionEnd = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (ANY_HEADER.test(lines[i] ?? "")) {
      sectionEnd = i;
      break;
    }
  }
  for (let i = headerIndex + 1; i < sectionEnd; i += 1) {
    const match = COMMAND_LINE.exec(lines[i] ?? "");
    if (!match) continue;
    const existing = tomlUnquote(match[1] ?? "");
    if (existing === command) return { kind: "unchanged" };
    const replaced = [...lines];
    replaced[i] = commandLine;
    // An earlier install of ourselves (npm link, another path) is ours to update, not someone else's config.
    if (isOurCommand(existing)) return { kind: "write", text: replaced.join("\n") };
    return { kind: "conflict", existing, text: replaced.join("\n") };
  }
  const inserted = [...lines];
  inserted.splice(headerIndex + 1, 0, commandLine);
  return { kind: "write", text: inserted.join("\n") };
}

export const DEFAULT_COMMAND = "kimi-dashboard statusline";

export interface SetupContext {
  env: NodeJS.ProcessEnv;
  home: string;
  /** Absolute path of the running bundle, for `--self`. */
  selfPath?: string;
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

async function confirm(question: string): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/**
 * Exit 0 on success / no-op, 2 when a foreign command was left in place.
 *   --self     use `node "<this bundle>" statusline` (plugin installs, no PATH needed)
 *   --quiet    print nothing; never prompt (for the SessionStart hook)
 *   --force    replace a foreign command without asking
 *   --command  explicit command string
 */
export async function runSetup(args: string[], ctx: SetupContext): Promise<number> {
  const quiet = args.includes("--quiet");
  const explicit = flagValue(args, "--command");
  const command = explicit ?? (args.includes("--self") && ctx.selfPath ? `node "${ctx.selfPath}" statusline` : DEFAULT_COMMAND);
  const tuiPath = join(kimiHome(ctx.env, ctx.home), "tui.toml");
  const say = (text: string) => {
    if (!quiet) process.stdout.write(`${text}\n`);
  };
  let text = "";
  try {
    text = readFileSync(tuiPath, "utf8");
  } catch {
    // no tui.toml yet: kimi-code accepts a file with just our section
  }

  const plan = planStatusLineCommand(text, command);
  switch (plan.kind) {
    case "unchanged":
      say(`✔ nothing to do: ${tuiPath} status_line.command = "${command}"`);
      break;
    case "write":
      writeAtomic(tuiPath, plan.text);
      say(`✔ wrote [status_line] command = "${command}" to ${tuiPath}`);
      break;
    case "conflict": {
      say(`✖ ${tuiPath} has a different status_line.command: "${plan.existing}"`);
      if (!args.includes("--force")) {
        if (quiet || !process.stdin.isTTY) {
          say(`   left unchanged; re-run with --force to replace it with "${command}"`);
          return 2;
        }
        if (!(await confirm(`Replace it with "${command}"? [y/N] `))) {
          say("left unchanged");
          return 2;
        }
      }
      writeAtomic(tuiPath, plan.text);
      say(`✔ replaced it with "${command}" in ${tuiPath}`);
      break;
    }
  }

  if (command.startsWith("kimi-dashboard") && findOnPath(ctx.env, "kimi-dashboard") === null) {
    say(`⚠ kimi-dashboard is not on PATH right now; install it globally (npm i -g kimi-dashboard) or re-run with --command "node /abs/path/dist/cli.js statusline"`);
  }
  say("Run /reload in kimi-code (or restart it) to apply.");
  return 0;
}
