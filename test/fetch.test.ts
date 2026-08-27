import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { fetchUsages } from "../src/quota/fetch.js";
import { startUsagesServer } from "./helpers.js";

const wire = readFileSync(new URL("./fixtures/usages.json", import.meta.url), "utf8");

test("GET {base}/usages with the bearer token returns the JSON body", async () => {
  const server = await startUsagesServer(() => ({ status: 200, body: wire }));
  try {
    const result = await fetchUsages({ baseUrl: `${server.baseUrl}/`, accessToken: "at-abc" });
    expect(result).toEqual({ kind: "ok", wire: JSON.parse(wire) });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ method: "GET", url: "/coding/v1/usages" });
    expect(server.requests[0]!.headers["authorization"]).toBe("Bearer at-abc");
    expect(server.requests[0]!.headers["accept"]).toBe("application/json");
  } finally {
    await server.close();
  }
});

test("HTTP errors, connection failures, bad JSON and timeouts come back as typed errors without the token", async () => {
  const unauthorized = await startUsagesServer(() => ({ status: 401, body: '{"error":"nope"}' }));
  const notJson = await startUsagesServer(() => ({ status: 200, body: "<html>" }));
  const slow = await startUsagesServer(() => ({ status: 200, body: "{}", delayMs: 500 }));
  try {
    const http = await fetchUsages({ baseUrl: unauthorized.baseUrl, accessToken: "at-SECRET" });
    expect(http).toEqual({ kind: "error", code: "http", status: 401, message: "HTTP 401" });

    const bad = await fetchUsages({ baseUrl: notJson.baseUrl, accessToken: "at-SECRET" });
    expect(bad).toMatchObject({ kind: "error", code: "bad-response", status: 200 });

    const timeout = await fetchUsages({ baseUrl: slow.baseUrl, accessToken: "at-SECRET", timeoutMs: 50 });
    expect(timeout).toEqual({ kind: "error", code: "network", message: "request timed out" });

    const refused = await fetchUsages({ baseUrl: "http://127.0.0.1:1/coding/v1", accessToken: "at-SECRET" });
    expect(refused).toMatchObject({ kind: "error", code: "network" });
    for (const r of [http, bad, timeout, refused]) expect(JSON.stringify(r)).not.toContain("SECRET");
  } finally {
    await Promise.all([unauthorized.close(), notJson.close(), slow.close()]);
  }
});
