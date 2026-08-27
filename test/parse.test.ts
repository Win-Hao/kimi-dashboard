import { expect, test } from "vitest";
import { parseUsages } from "../src/quota/parse.js";

test("string numbers in the wire payload become integers", () => {
  const data = parseUsages({
    usage: { used: "40", limit: "1000", resetTime: "2026-08-03T05:20:51Z" },
    limits: [
      {
        window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
        detail: { used: "1", limit: "100", resetTime: "2026-08-01T09:00:00Z" },
      },
    ],
  });
  expect(data.summary).toMatchObject({ used: 40, limit: 1000, resetAt: "2026-08-03T05:20:51Z" });
  expect(data.limits).toHaveLength(1);
  expect(data.limits[0]).toMatchObject({ used: 1, limit: 100, resetAt: "2026-08-01T09:00:00Z" });
});

test("proto-style time units are normalised and 300 minutes reads as a 5-hour window", () => {
  const data = parseUsages({
    usage: { used: "40", limit: "1000" },
    limits: [
      { window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { used: "1", limit: "100" } },
      { window: { duration: 1, timeUnit: "TIME_UNIT_DAY" }, detail: { used: "0", limit: "5" } },
      { window: { duration: 7, timeUnit: "TIME_UNIT_BOGUS" }, detail: { used: "0", limit: "5" } },
    ],
  });
  expect(data.limits[0]!.window).toEqual({ duration: 5, unit: "hour" });
  expect(data.limits[0]!.name).toBe("5h");
  expect(data.limits[1]!.window).toEqual({ duration: 1, unit: "day" });
  expect(data.limits[1]!.name).toBe("1d");
  expect(data.limits[2]!.window).toBeUndefined();
});

test("top-level usage carries no window: it is the weekly quota", () => {
  const data = parseUsages({ usage: { used: "40", limit: "1000" } });
  expect(data.summary!.window).toEqual({ duration: 1, unit: "week" });
  expect(data.summary!.name).toBe("weekly");
});

test("booster wallet: fixed-point amounts become cents, priceInCents stays as-is", () => {
  const data = parseUsages({
    boosterWallet: {
      balance: { type: "BOOSTER", amount: "10000000000", amountLeft: "4200000000" },
      monthlyChargeLimitEnabled: true,
      monthlyChargeLimit: { priceInCents: "20000", currency: "CNY" },
      monthlyUsed: { priceInCents: "5800", currency: "CNY" },
    },
  });
  expect(data.extraUsage).toEqual({
    balanceCents: 4200,
    totalCents: 10000,
    monthlyChargeLimitEnabled: true,
    monthlyChargeLimitCents: 20000,
    monthlyUsedCents: 5800,
    currency: "CNY",
  });
});

test("booster wallet: sub-cent balance rounds up to 1 cent; non-booster or absent wallet is null", () => {
  const tiny = parseUsages({ boosterWallet: { balance: { type: "BOOSTER", amount: "10000000000", amountLeft: "500000" } } });
  expect(tiny.extraUsage?.balanceCents).toBe(1);
  expect(tiny.extraUsage?.currency).toBe("USD");
  expect(parseUsages({ boosterWallet: { balance: { type: "OTHER", amount: "1" } } }).extraUsage).toBeNull();
  expect(parseUsages({ usage: { used: "1", limit: "2" } }).extraUsage).toBeNull();
});

test("garbage input never throws and yields an empty quota", () => {
  const empty = { summary: null, limits: [], extraUsage: null };
  expect(parseUsages(null)).toEqual(empty);
  expect(parseUsages("nope")).toEqual(empty);
  expect(parseUsages([1, 2])).toEqual(empty);
  expect(parseUsages({ usage: "nope", limits: "nope", boosterWallet: 3 })).toEqual(empty);
  expect(parseUsages({ usage: { used: "abc" }, limits: [null, 4, { detail: null }] })).toEqual(empty);
});

test("the recorded /usages fixture parses to the documented cache shape", async () => {
  const { readFile } = await import("node:fs/promises");
  const wire: unknown = JSON.parse(await readFile(new URL("./fixtures/usages.json", import.meta.url), "utf8"));
  expect(parseUsages(wire)).toEqual({
    summary: { name: "weekly", window: { duration: 1, unit: "week" }, used: 40, limit: 1000, resetAt: "2026-08-03T05:20:51Z" },
    limits: [{ name: "5h", window: { duration: 5, unit: "hour" }, used: 18, limit: 100, resetAt: "2026-08-01T09:00:00Z" }],
    extraUsage: {
      balanceCents: 4200,
      totalCents: 10000,
      monthlyChargeLimitEnabled: true,
      monthlyChargeLimitCents: 20000,
      monthlyUsedCents: 5800,
      currency: "CNY",
    },
  });
});
