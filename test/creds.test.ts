import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readCredential } from "../src/quota/creds.js";

const NOW = 1_786_080_000; // unix seconds
const REFRESH_TOKEN = "rt-SECRET-never-leaves-disk";

function homeWith(credential: unknown, name = "kimi-code"): string {
  const home = mkdtempSync(join(tmpdir(), "kimi-dashboard-home-"));
  mkdirSync(join(home, "credentials"), { mode: 0o700 });
  writeFileSync(join(home, "credentials", `${name}.json`), typeof credential === "string" ? credential : JSON.stringify(credential), { mode: 0o600 });
  return home;
}

test("a valid credential yields only the access token and expiry; the refresh token never enters the result", () => {
  const home = homeWith({
    access_token: "at-abc",
    refresh_token: REFRESH_TOKEN,
    expires_at: NOW + 3600,
    scope: "openid",
    token_type: "Bearer",
    expires_in: 3600,
  });
  const result = readCredential({ home, now: NOW });
  expect(result).toEqual({ kind: "ok", accessToken: "at-abc", expiresAt: NOW + 3600 });
  expect(JSON.stringify(result)).not.toContain(REFRESH_TOKEN);
});

test("a token expiring within 60 seconds counts as expired and is never refreshed", () => {
  const credential = (expiresAt: number) => ({ access_token: "at", refresh_token: REFRESH_TOKEN, expires_at: expiresAt });
  expect(readCredential({ home: homeWith(credential(NOW + 60)), now: NOW })).toEqual({ kind: "expired", expiresAt: NOW + 60 });
  expect(readCredential({ home: homeWith(credential(NOW - 5)), now: NOW })).toEqual({ kind: "expired", expiresAt: NOW - 5 });
  expect(readCredential({ home: homeWith(credential(NOW + 61)), now: NOW })).toEqual({ kind: "ok", accessToken: "at", expiresAt: NOW + 61 });
});

test("absent or unreadable credentials degrade to missing / invalid instead of throwing", () => {
  expect(readCredential({ home: join(tmpdir(), "definitely-not-a-kimi-home"), now: NOW })).toEqual({ kind: "missing" });
  expect(readCredential({ home: homeWith("{ nope"), now: NOW })).toEqual({ kind: "invalid" });
  expect(readCredential({ home: homeWith({ refresh_token: REFRESH_TOKEN, expires_at: NOW + 3600 }), now: NOW })).toEqual({ kind: "invalid" });
  expect(readCredential({ home: homeWith({ access_token: "at", expires_at: "soon" }), now: NOW })).toEqual({ kind: "invalid" });
  expect(readCredential({ home: homeWith([1, 2]), now: NOW })).toEqual({ kind: "invalid" });
});

test("a non-default KIMI_CODE_BASE_URL reads the env-scoped credential slot kimi-code uses", async () => {
  const { credentialName, readCredential: read } = await import("../src/quota/creds.js");
  expect(credentialName({})).toBe("kimi-code");
  expect(credentialName({ KIMI_CODE_BASE_URL: "https://api.kimi.com/coding/v1/" })).toBe("kimi-code");
  // sha256(JSON.stringify({ oauthHost, baseUrl })) prefix, mirroring kimi-code's resolveKimiCodeOAuthKey
  const scoped = "kimi-code-env-c30a4fd67b02b7dd";
  expect(credentialName({ KIMI_CODE_BASE_URL: "https://example.test/v1/" })).toBe(scoped);
  const home = homeWith({ access_token: "at-scoped", refresh_token: REFRESH_TOKEN, expires_at: NOW + 3600 }, scoped);
  expect(read({ home, now: NOW, name: credentialName({ KIMI_CODE_BASE_URL: "https://example.test/v1" }) })).toEqual({ kind: "ok", accessToken: "at-scoped", expiresAt: NOW + 3600 });
  expect(read({ home, now: NOW })).toEqual({ kind: "missing" });
});
