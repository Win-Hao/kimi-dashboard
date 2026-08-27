import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_BASE_URL, apiBaseUrl } from "../paths.js";

/**
 * READ-ONLY access to kimi-code's OAuth credential (SPEC §6.2).
 *
 * This module must never write to, refresh, or log anything from the
 * credentials directory. kimi-code serialises token refreshes in-process only;
 * an external refresh would race it and can log the user out.
 */

export type CredentialResult =
  | { kind: "ok"; accessToken: string; expiresAt: number }
  | { kind: "missing" }
  | { kind: "expired"; expiresAt: number }
  | { kind: "invalid" };

/** Treat tokens that expire within this margin as already expired. */
export const EXPIRY_MARGIN_SECONDS = 60;

export interface ReadCredentialOptions {
  /** kimi-code home (KIMI_CODE_HOME or ~/.kimi-code). */
  home: string;
  /** Unix seconds; defaults to the wall clock. */
  now?: number;
  /** Credential file stem under `credentials/`; defaults to the managed Kimi Code slot. */
  name?: string;
}

export const DEFAULT_CREDENTIAL_NAME = "kimi-code";
const DEFAULT_OAUTH_HOST = "https://auth.kimi.com";
const SCOPED_PREFIX = "kimi-code-env-";

function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Which credential slot kimi-code stores the token in. The default endpoint
 * uses `kimi-code.json`; any other (oauthHost, baseUrl) pair gets its own
 * hashed slot, exactly as kimi-code's resolveKimiCodeOAuthKey does.
 */
export function credentialName(env: NodeJS.ProcessEnv): string {
  const oauthHost = normalizeEndpoint(env["KIMI_CODE_OAUTH_HOST"] ?? env["KIMI_OAUTH_HOST"] ?? DEFAULT_OAUTH_HOST);
  const baseUrl = apiBaseUrl(env);
  if (oauthHost === DEFAULT_OAUTH_HOST && baseUrl === DEFAULT_BASE_URL) return DEFAULT_CREDENTIAL_NAME;
  const digest = createHash("sha256").update(JSON.stringify({ oauthHost, baseUrl })).digest("hex").slice(0, 16);
  return `${SCOPED_PREFIX}${digest}`;
}

export function credentialsDir(home: string): string {
  return join(home, "credentials");
}

export function credentialPath(home: string, name = DEFAULT_CREDENTIAL_NAME): string {
  return join(credentialsDir(home), `${name}.json`);
}

export function readCredential(options: ReadCredentialOptions): CredentialResult {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  let raw: string;
  try {
    raw = readFileSync(credentialPath(options.home, options.name), "utf8");
  } catch {
    return { kind: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { kind: "invalid" };
  // Pick out exactly the two fields we need; everything else (refresh_token!) is dropped here.
  const record = parsed as Record<string, unknown>;
  const accessToken = record["access_token"];
  const expiresAt = record["expires_at"];
  if (typeof accessToken !== "string" || accessToken.length === 0) return { kind: "invalid" };
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return { kind: "invalid" };
  if (expiresAt <= now + EXPIRY_MARGIN_SECONDS) return { kind: "expired", expiresAt };
  return { kind: "ok", accessToken, expiresAt };
}
