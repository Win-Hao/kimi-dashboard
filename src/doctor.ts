import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { configPath, loadConfig } from "./config.js";
import { apiBaseUrl, findOnPath, kimiHome } from "./paths.js";
import { cachePath, readCache } from "./quota/cache.js";
import { credentialName, credentialPath, credentialsDir, readCredential } from "./quota/creds.js";
import { fetchUsages } from "./quota/fetch.js";
import { payloadKeysPath } from "./statusline.js";

export interface DoctorContext {
  env: NodeJS.ProcessEnv;
  home: string;
  version: string;
  /** Skip the network check (tests / offline). */
  offline?: boolean;
}

const OK = "✔";
const BAD = "✖";

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** Prints a diagnosis. Never prints tokens (SPEC §6.2). Exit 0 when everything checks out. */
export async function runDoctor(ctx: DoctorContext): Promise<number> {
  const { env, home } = ctx;
  const lines: string[] = [`kimi-dashboard v${ctx.version} doctor`];
  let healthy = true;
  const row = (label: string, text: string) => lines.push(`${label.padEnd(16)} ${text}`);

  const kh = kimiHome(env, home);
  row("kimi-code home", `${kh}${env["KIMI_CODE_HOME"] ? " (KIMI_CODE_HOME)" : ""}`);

  const tuiPath = join(kh, "tui.toml");
  let tui = "";
  try {
    tui = readFileSync(tuiPath, "utf8");
  } catch {
    // missing is reported below
  }
  const section = /^\s*\[status_line\][^[]*/m.exec(tui)?.[0] ?? "";
  const command = /^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(section)?.[1];
  if (command) row("tui.toml", `${OK} status_line.command = "${command}"`);
  else {
    healthy = false;
    row("tui.toml", `${BAD} status_line.command not set — run: kimi-dashboard setup`);
  }

  const name = credentialName(env);
  const credential = readCredential({ home: kh, name });
  const relative = `credentials/${name}.json`;
  const nowS = Math.floor(Date.now() / 1000);
  switch (credential.kind) {
    case "ok":
      row("credential", `${OK} ${relative} valid, expires in ${ago((credential.expiresAt - nowS) * 1000)}`);
      break;
    case "expired":
      healthy = false;
      row("credential", `${BAD} ${relative} expired ${ago((nowS - credential.expiresAt) * 1000)} ago — keep using kimi-code and it will refresh`);
      break;
    case "invalid":
      healthy = false;
      row("credential", `${BAD} ${relative} unreadable`);
      break;
    case "missing": {
      healthy = false;
      let others: string[] = [];
      try {
        others = readdirSync(credentialsDir(kh)).filter((f) => f.endsWith(".json"));
      } catch {
        // no directory at all
      }
      row("credential", `${BAD} ${credentialPath(kh, name)} missing — run /login in kimi-code${others.length ? ` (found: ${others.join(", ")})` : ""}`);
      break;
    }
  }

  const baseUrl = apiBaseUrl(env);
  row("api base", `${baseUrl}${env["KIMI_CODE_BASE_URL"] ? " (KIMI_CODE_BASE_URL)" : ""}`);

  const cacheFile = cachePath(env, home);
  const cache = readCache(cacheFile);
  if (cache) {
    const fetched = cache.fetchedAt > 0 ? `fetched ${ago(Date.now() - cache.fetchedAt)} ago` : "no successful fetch yet";
    row("cache", `${cache.ok ? OK : BAD} ${cacheFile} ${fetched}${cache.ok ? "" : `, last error: ${cache.error ?? cache.errorCode ?? "unknown"}`}`);
    if (!cache.ok) healthy = false;
  } else row("cache", `${cacheFile} not written yet (appears after the first statusline run)`);

  const cfgPath = configPath(env, home);
  const cfg = loadConfig(cfgPath);
  row("config", `${existsSync(cfgPath) ? cfgPath : `(defaults; ${cfgPath} absent)`} segments=${cfg.segments.join(",")} refresh=${cfg.refreshIntervalMs}ms stale=${cfg.staleAfterMs}ms`);

  let keys: string[] = [];
  try {
    keys = JSON.parse(readFileSync(payloadKeysPath(env, home), "utf8")) as string[];
  } catch {
    // never ran
  }
  row("payload keys", keys.length ? keys.join(", ") : "none recorded yet (kimi-code has not called statusline)");

  if (ctx.offline) row("connectivity", "skipped (offline)");
  else if (credential.kind !== "ok") row("connectivity", "skipped (no usable credential)");
  else {
    const started = Date.now();
    const result = await fetchUsages({ baseUrl, accessToken: credential.accessToken, timeoutMs: 8000 });
    if (result.kind === "ok") row("connectivity", `${OK} GET ${baseUrl}/usages → 200 (${Date.now() - started}ms)`);
    else {
      healthy = false;
      row("connectivity", `${BAD} GET ${baseUrl}/usages → ${result.status ?? result.code}: ${result.message}`);
    }
  }

  const found = findOnPath(env, "kimi-dashboard");
  if (found) row("PATH", `${OK} kimi-dashboard → ${found}`);
  else row("PATH", `${BAD} kimi-dashboard not on PATH — install globally (npm i -g kimi-dashboard) or setup --command "node /abs/path/dist/cli.js statusline"`);
  try {
    row("last modified", `${statSync(tuiPath).mtime.toISOString()} (tui.toml)`);
  } catch {
    // reported above as missing
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  return healthy ? 0 : 1;
}
