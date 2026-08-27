import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { configPath, loadConfig } from "./config.js";
import { runConfig } from "./configure.js";
import { detectLang } from "./lang.js";
import { runDaemon } from "./daemon.js";
import { runDoctor } from "./doctor.js";
import { runPreview } from "./preview.js";
import { refresh } from "./quota/refresh.js";
import { runSetup } from "./setup.js";
import { statusline } from "./statusline.js";

export const VERSION = process.env["KIMI_DASHBOARD_VERSION"] ?? "dev";

const HELP = `kimi-dashboard v${VERSION} — Kimi Code quota in the kimi-code footer (unofficial)

Usage: kimi-dashboard <command> [options]

  statusline   read the kimi-code payload from stdin, print one footer line
  refresh      fetch /usages once and update the cache        [--json]
  daemon       keep refreshing on an interval (optional)      [--interval-ms N] [--verbose]
  setup        write [status_line] command into tui.toml      [--force] [--command "<cmd>"]
  doctor       check credential / cache / config / connectivity
  preview      render sample data, no network                 [--hot] [--stale] [--no-auth] [--expired] [--empty] [--not-kimi] [--bar] [--ascii] [--width N] [--color]
  config       show or change what the line displays         [--preset compact|full|quota] [key=value ...]
               e.g. config segments=model,5h,7d,git quotaStyle=bar separator=dot
  lang         print the language to talk to the user in (zh|en): config lang, else $LANG
`;

const SELF = fileURLToPath(import.meta.url);

/** Detach `refresh` into its own process group so the host's timeout kill (SIGKILL -pgid) cannot reach it. */
function spawnRefresh(): void {
  try {
    const child = spawn(process.execPath, [SELF, "refresh"], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // a failed spawn is invisible by design; the next tick retries
  }
}

/** Hot path: never exits non-zero, never writes stderr, always one line (SPEC §6.3). */
function runStatusline(): number {
  process.on("uncaughtException", () => {});
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    // no stdin → invalid payload → empty line → host falls back
  }
  const line = statusline({ stdin, env: process.env, home: homedir(), spawnRefresh });
  process.stdout.write(`${line}\n`);
  return 0;
}

async function runRefresh(args: string[]): Promise<number> {
  const outcome = await refresh({ env: process.env, home: homedir() });
  if (args.includes("--json")) process.stdout.write(`${JSON.stringify(outcome)}\n`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [command = "help", ...rest] = argv;
  switch (command) {
    case "statusline":
      return runStatusline();
    case "refresh":
      return runRefresh(rest);
    case "daemon":
      return runDaemon(rest, { env: process.env, home: homedir() });
    case "setup":
      return runSetup(rest, { env: process.env, home: homedir(), selfPath: SELF });
    case "doctor":
      return runDoctor({ env: process.env, home: homedir(), version: VERSION });
    case "preview":
      return runPreview(rest, { env: process.env, home: homedir() });
    case "config":
      return runConfig(rest, { env: process.env, home: homedir() });
    case "lang":
      process.stdout.write(`${detectLang(loadConfig(configPath(process.env, homedir())).lang, process.env)}\n`);
      return 0;
    case "--version":
    case "-v":
    case "version":
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // statusline never reaches here (it catches everything); other commands may report.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
