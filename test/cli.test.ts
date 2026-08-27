/**
 * End-to-end through the bundled binary (dist/cli.js), exactly as kimi-code
 * would invoke it: a child process with the payload on stdin.
 *
 * Everything here is async on purpose: the loopback /usages server lives in
 * this process, so a blocking spawnSync would starve it.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, test } from "vitest";
import { credentialName } from "../src/quota/creds.js";
import { makeKimiHome, startUsagesServer, tempDir } from "./helpers.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli.js");
const wire = readFileSync(new URL("./fixtures/usages.json", import.meta.url), "utf8");
const payload = JSON.stringify({ model: "kimi-k2", cwd: "/Users/you/proj", gitBranch: "main", contextUsage: 0.32, contextTokens: 64000, maxContextTokens: 200000 });
const NOW_S = Math.floor(Date.now() / 1000);
const UNREACHABLE = "http://127.0.0.1:1/coding/v1";

beforeAll(() => {
  execFileSync(process.execPath, [join(root, "node_modules", "tsup", "dist", "cli-default.js")], { cwd: root, stdio: "ignore" });
}, 60_000);

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

function run(args: string[], env: NodeJS.ProcessEnv, stdin = ""): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { env: { PATH: process.env["PATH"], NO_COLOR: "1", COLUMNS: "200", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("close", (status) => resolve({ stdout, stderr, status }));
    child.stdin.end(stdin);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** `credential: null` → no credential file at all (undefined would select the default). */
function e2eEnv(baseUrl: string, credential: unknown = { access_token: "at-e2e", refresh_token: "rt-SECRET", expires_at: NOW_S + 3600 }) {
  return {
    KIMI_CODE_HOME: makeKimiHome(credential, credentialName({ KIMI_CODE_BASE_URL: baseUrl })),
    KIMI_CODE_BASE_URL: baseUrl,
    XDG_CACHE_HOME: tempDir("kimi-cache-"),
    XDG_CONFIG_HOME: tempDir("kimi-config-"),
  };
}

test("statusline prints one line with exit 0, spawns a detached refresh, and the next call shows real quota", async () => {
  const server = await startUsagesServer(() => ({ status: 200, body: wire }));
  const env = e2eEnv(server.baseUrl);
  try {
    expect(await run(["statusline"], env, payload)).toEqual({ stdout: "kimi-k2 | ###------- 32% | 62.5k/195k | 5h: -- | 7d: -- | main | proj\n", stderr: "", status: 0 });

    const cacheFile = join(env.XDG_CACHE_HOME, "kimi-dashboard", "quota.json");
    await waitFor(() => existsSync(cacheFile));
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.headers["authorization"]).toBe("Bearer at-e2e");

    expect(await run(["statusline"], env, payload)).toEqual({ stdout: "kimi-k2 | ###------- 32% | 62.5k/195k | 5h: 18% | 7d: 4% | ¥42.00 | ¥58.00/¥200.00 | main | proj\n", stderr: "", status: 0 });
    // fresh cache → no second request
    expect(server.requests).toHaveLength(1);
  } finally {
    await server.close();
  }
});

test("malformed stdin or an unwritable cache location still yields exit 0, one line, silent stderr", async () => {
  const env = e2eEnv(UNREACHABLE);
  expect(await run(["statusline"], env, "{ nope")).toEqual({ stdout: "\n", stderr: "", status: 0 });
  expect(await run(["statusline"], env, "")).toEqual({ stdout: "\n", stderr: "", status: 0 });
  writeFileSync(join(env.XDG_CACHE_HOME, "a-file"), "");
  const unwritable = await run(["statusline"], { ...env, XDG_CACHE_HOME: join(env.XDG_CACHE_HOME, "a-file", "not-a-dir") }, payload);
  expect(unwritable).toEqual({ stdout: "kimi-k2 | ###------- 32% | 62.5k/195k | 5h: -- | 7d: -- | main | proj\n", stderr: "", status: 0 });
});

test("preview renders sample data without network or credentials", async () => {
  const env = e2eEnv(UNREACHABLE, null);
  expect(await run(["preview"], env)).toEqual({ stdout: "kimi-k2 | ###------- 32% | 62.5k/195k | 5h: 18% (32m) | 7d: 34% (1d20h) | ¥42.00 | ¥58.00/¥200.00 | auto | main | demo | 1h5m | v0.39.0\n", stderr: "", status: 0 });
  expect((await run(["preview", "--no-auth"], env)).stdout).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h/7d no auth | auto | main | demo | 1h5m | v0.39.0\n");
  expect((await run(["preview", "--expired", "--width", "50"], { ...env, LANG: "zh_CN.UTF-8" })).stdout).toBe("额度不可用 · 请在 kimi-code 中继续使用以刷新凭证\n");
  expect((await run(["preview", "--expired", "--width", "70"], { ...env, LANG: "en_US.UTF-8" })).stdout).toBe("quota unavailable · keep using kimi-code to refresh the login\n");
  expect((await run(["preview", "--stale", "--width", "50"], env)).stdout).toBe("~5h: 18% (32m)\n");
  expect((await run(["preview", "--empty"], env)).stdout).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h: -- | 7d: -- | auto | main | demo | 1h5m | v0.39.0\n");
  expect((await run(["preview", "--ctx"], env)).stdout).toContain("###------- 32%");
  expect((await run(["preview", "--bar", "--width", "50"], env)).stdout).toBe("5h ##-------- 18% (32m)\n");
  expect((await run(["preview", "--hot"], env)).stdout).toBe("kimi-k2 | #########- 88% | 172k/195k | 5h: 85% (32m) | 7d: 92% (1d20h) | ¥42.00 | ¥175.00/¥200.00 | auto | main | demo | 1h5m | v0.39.0\n");
  expect((await run(["preview", "--not-kimi"], env)).stdout).toBe("DeepSeek V4 Flash | ###------- 32% | 62.5k/195k | auto | main | demo | 1h5m | v0.39.0\n");
  const coloured = (await run(["preview", "--color"], { ...env, NO_COLOR: "", TERM: "xterm-256color" })).stdout;
  expect(coloured).toContain("\x1b[38;5;117m◆ kimi-k2\x1b[0m");
  expect(coloured).toContain("\x1b[2m│\x1b[0m");
});

test("setup writes tui.toml, is idempotent, and refuses to clobber a foreign command without --force", async () => {
  const env = e2eEnv(UNREACHABLE);
  const tui = join(env.KIMI_CODE_HOME, "tui.toml");
  const first = await run(["setup"], env);
  expect(first.status).toBe(0);
  expect(first.stderr).toBe("");
  expect(readFileSync(tui, "utf8")).toBe('[status_line]\ncommand = "kimi-dashboard statusline"\n');
  const again = await run(["setup"], env);
  expect(again.status).toBe(0);
  expect(again.stdout).toContain("✔ nothing to do");

  writeFileSync(tui, 'theme = "dark"\n\n[status_line]\ncommand = "~/.kimi-code/statusline.sh"\n');
  const refused = await run(["setup"], env);
  expect(refused.status).toBe(2);
  expect(refused.stdout).toContain("--force");
  expect(readFileSync(tui, "utf8")).toContain('command = "~/.kimi-code/statusline.sh"');

  const forced = await run(["setup", "--force", "--command", "node /opt/kd/dist/cli.js statusline"], env);
  expect(forced.status).toBe(0);
  expect(readFileSync(tui, "utf8")).toBe('theme = "dark"\n\n[status_line]\ncommand = "node /opt/kd/dist/cli.js statusline"\n');
});

test("refresh --json reports the outcome; doctor reports every check and never leaks token material", async () => {
  const server = await startUsagesServer(() => ({ status: 200, body: wire }));
  const env = e2eEnv(server.baseUrl);
  try {
    const refreshed = await run(["refresh", "--json"], env);
    expect(refreshed.status).toBe(0);
    expect(JSON.parse(refreshed.stdout)).toMatchObject({ kind: "written", cache: { ok: true, summary: { used: 40, limit: 1000 } } });

    await run(["setup"], env);
    await run(["statusline"], env, payload);
    const doctor = await run(["doctor"], env);
    expect(doctor.stderr).toBe("");
    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain('status_line.command = "kimi-dashboard statusline"');
    expect(doctor.stdout).toMatch(/credential\s+✔ .*valid, expires in/);
    expect(doctor.stdout).toMatch(/cache\s+✔ .*fetched \d+s ago/);
    expect(doctor.stdout).toMatch(/connectivity\s+✔ GET .*\/usages → 200/);
    expect(doctor.stdout).toContain("payload keys     model, cwd, gitBranch, contextUsage, contextTokens, maxContextTokens");
    expect(doctor.stdout).not.toContain("at-e2e");
    expect(doctor.stdout).not.toContain("rt-SECRET");

    const missing = await run(["doctor"], e2eEnv(server.baseUrl, null));
    expect(missing.status).toBe(1);
    expect(missing.stdout).toMatch(/credential\s+✖ .*missing/);
    expect(missing.stdout).toMatch(/connectivity\s+skipped/);
  } finally {
    await server.close();
  }
});

test("daemon refreshes on an interval and exits after --max-iterations", async () => {
  const server = await startUsagesServer(() => ({ status: 200, body: wire }));
  const env = e2eEnv(server.baseUrl);
  try {
    expect(await run(["daemon", "--interval-ms", "30", "--max-iterations", "3"], env)).toEqual({ stdout: "", stderr: "", status: 0 });
    expect(server.requests).toHaveLength(3);
    expect(existsSync(join(env.XDG_CACHE_HOME, "kimi-dashboard", "quota.json"))).toBe(true);
  } finally {
    await server.close();
  }
});

test("help, version and unknown commands", async () => {
  const env = e2eEnv(UNREACHABLE);
  expect((await run(["--version"], env)).stdout).toBe("0.1.0\n");
  expect((await run(["help"], env)).stdout).toContain("Usage: kimi-dashboard <command>");
  const unknown = await run(["bogus"], env);
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toContain("unknown command: bogus");
});

test("setup --self points tui.toml at this very bundle by absolute path, and --quiet keeps hooks silent", async () => {
  const env = e2eEnv(UNREACHABLE);
  const tui = join(env.KIMI_CODE_HOME, "tui.toml");
  const first = await run(["setup", "--self", "--quiet"], env);
  expect(first).toEqual({ stdout: "", stderr: "", status: 0 });
  const cliToml = cli.replace(/\\/g, "\\\\"); // TOML basic string: backslashes (Windows paths) are escaped
  expect(readFileSync(tui, "utf8")).toBe(`[status_line]\ncommand = "node \\"${cliToml}\\" statusline"\n`);
  // idempotent and silent on the next session start
  expect(await run(["setup", "--self", "--quiet"], env)).toEqual({ stdout: "", stderr: "", status: 0 });
  // never clobbers someone else's command from a hook
  writeFileSync(tui, '[status_line]\ncommand = "~/.kimi-code/statusline.sh"\n');
  expect(await run(["setup", "--self", "--quiet"], env)).toEqual({ stdout: "", stderr: "", status: 2 });
  expect(readFileSync(tui, "utf8")).toContain("statusline.sh");
  // the command it wrote actually works when kimi-code runs it through the platform shell
  if (process.platform === "win32") return; // kimi-code uses cmd.exe there; the quoting is covered by the TOML assertions above
  writeFileSync(tui, `[status_line]\ncommand = "node \\"${cli}\\" statusline"\n`);
  const viaSh = spawn("sh", ["-c", `node "${cli}" statusline`], { env: { PATH: process.env["PATH"], NO_COLOR: "1", COLUMNS: "200", ...env } });
  let out = "";
  viaSh.stdout.setEncoding("utf8").on("data", (c: string) => (out += c));
  viaSh.stdin.end(payload);
  await new Promise((resolve) => viaSh.on("close", resolve));
  expect(out).toBe("kimi-k2 | ###------- 32% | 62.5k/195k | 5h: -- | 7d: -- | main | proj\n");
});

test("config shows, presets and key=value edit the display, invalid input leaves the file untouched", async () => {
  const env = e2eEnv(UNREACHABLE);
  const file = join(env.XDG_CONFIG_HOME, "kimi-dashboard", "config.toml");
  const shown = await run(["config"], env);
  expect(shown.status).toBe(0);
  expect(shown.stdout).toContain(`${file} (absent, using defaults)`);
  expect(shown.stdout).toContain('segments = ["model", "ctx", "tokens", "5h", "7d", "booster", "spend", "mode", "git", "cwd", "session", "version"]');

  const compact = await run(["config", "--preset", "compact"], env);
  expect(compact.status).toBe(0);
  expect(readFileSync(file, "utf8")).toContain('segments = ["model", "ctx", "tokens", "5h", "7d"]');
  expect(compact.stdout).toContain("preview: kimi-k2 | ###------- 32% | 62.5k/195k | 5h: 18% (32m) | 7d: 34% (1d20h)");

  const edited = await run(["config", "segments=5h,7d,git", "quotaStyle=bar", "separator=dot"], env);
  expect(edited.status).toBe(0);
  expect(readFileSync(file, "utf8")).toContain('segments = ["5h", "7d", "git"]');
  expect(readFileSync(file, "utf8")).toContain('quotaStyle = "bar"');
  expect(edited.stdout).toContain("preview: 5h ##-------- 18% (32m) | 7d ###------- 34% (1d20h) | main");

  const before = readFileSync(file, "utf8");
  const bad = await run(["config", "segments=5h,bogus"], env);
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain('unknown segment "bogus"');
  expect(readFileSync(file, "utf8")).toBe(before);
  expect((await run(["config", "--preset", "nope"], env)).status).toBe(1);
});

test("lang prints the language the agent should talk in: config lang, else the OS locale, else en", async () => {
  const env = e2eEnv(UNREACHABLE);
  expect((await run(["lang"], { ...env, LANG: "zh_CN.UTF-8" })).stdout).toBe("zh\n");
  expect((await run(["lang"], { ...env, LANG: "en_GB.UTF-8" })).stdout).toBe("en\n");
  expect((await run(["lang"], env)).stdout).toBe("en\n");
  await run(["config", "lang=zh"], env);
  expect((await run(["lang"], { ...env, LANG: "en_US.UTF-8" })).stdout).toBe("zh\n");
});

test("config applies a preset and lang together — the single call the setup command makes after its layout + language questions", async () => {
  const env = e2eEnv(UNREACHABLE);
  const file = join(env.XDG_CONFIG_HOME, "kimi-dashboard", "config.toml");
  const both = await run(["config", "--preset", "compact", "lang=zh"], env);
  expect(both.status).toBe(0);
  expect(readFileSync(file, "utf8")).toContain('segments = ["model", "ctx", "tokens", "5h", "7d"]');
  expect(readFileSync(file, "utf8")).toContain('lang = "zh"');
  expect((await run(["lang"], { ...env, LANG: "en_US.UTF-8" })).stdout).toBe("zh\n");

  const custom = await run(["config", "segments=5h,7d,git", "lang=auto"], env);
  expect(custom.status).toBe(0);
  expect(readFileSync(file, "utf8")).toContain('segments = ["5h", "7d", "git"]');
  expect(readFileSync(file, "utf8")).toContain('lang = "auto"');
  expect((await run(["lang"], { ...env, LANG: "en_US.UTF-8" })).stdout).toBe("en\n");
});

test("config takes a bare preset name, as the README and /kimi-dashboard:setup <preset> promise", async () => {
  const env = e2eEnv(UNREACHABLE);
  const file = join(env.XDG_CONFIG_HOME, "kimi-dashboard", "config.toml");
  const compact = await run(["config", "compact"], env);
  expect(compact.status).toBe(0);
  expect(readFileSync(file, "utf8")).toContain('segments = ["model", "ctx", "tokens", "5h", "7d"]');

  const quota = await run(["config", "quota", "lang=zh"], env);
  expect(quota.status).toBe(0);
  expect(readFileSync(file, "utf8")).toContain('segments = ["5h", "7d", "booster", "spend", "mode", "git"]');
  expect(readFileSync(file, "utf8")).toContain('lang = "zh"');

  const before = readFileSync(file, "utf8");
  const typo = await run(["config", "compct"], env);
  expect(typo.status).toBe(1);
  expect(typo.stderr).toBe('expected a preset (compact, full, quota) or key=value (got "compct")\n');
  const dangling = await run(["config", "--preset"], env);
  expect(dangling.status).toBe(1);
  expect(dangling.stderr).toBe("--preset needs a value (compact, full, quota)\n");
  expect(readFileSync(file, "utf8")).toBe(before);
});
