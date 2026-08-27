import type { ExtraUsage, QuotaData, QuotaRow, QuotaWindow, TimeUnit } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wire numbers arrive as strings ("40"); accept both, never throw. */
function toInt(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

/** Proto enum (TIME_UNIT_MINUTE) → plain unit; unknown → null. */
function toTimeUnit(raw: unknown): TimeUnit | null {
  switch (raw) {
    case "TIME_UNIT_MINUTE":
      return "minute";
    case "TIME_UNIT_HOUR":
      return "hour";
    case "TIME_UNIT_DAY":
      return "day";
    case "TIME_UNIT_WEEK":
      return "week";
    default:
      return null;
  }
}

function toWindow(raw: unknown): QuotaWindow | undefined {
  if (!isRecord(raw)) return undefined;
  const duration = toInt(raw["duration"]);
  const unit = toTimeUnit(raw["timeUnit"]);
  if (duration === null || unit === null) return undefined;
  // "300 minutes" is how the wire spells the 5h window; fold whole hours.
  if (unit === "minute" && duration >= 60 && duration % 60 === 0) {
    return { duration: duration / 60, unit: "hour" };
  }
  return { duration, unit };
}

const UNIT_ABBREV: Record<TimeUnit, string> = { minute: "m", hour: "h", day: "d", week: "w" };

export function windowName(window: QuotaWindow | undefined): string {
  if (!window) return "quota";
  if (window.unit === "week" && window.duration === 1) return "weekly";
  return `${window.duration}${UNIT_ABBREV[window.unit]}`;
}

function toRow(raw: unknown, window: QuotaWindow | undefined, wireName: unknown): QuotaRow | null {
  if (!isRecord(raw)) return null;
  const used = toInt(raw["used"]);
  const limit = toInt(raw["limit"]);
  if (used === null && limit === null) return null;
  const name = typeof wireName === "string" && wireName.length > 0 ? wireName : windowName(window);
  const row: QuotaRow = { name, used: used ?? 0, limit: limit ?? 0 };
  if (window) row.window = window;
  const resetAt = raw["resetTime"];
  if (typeof resetAt === "string" && resetAt.length > 0) row.resetAt = resetAt;
  return row;
}

/** Booster amounts are fixed-point: amount / 1e6 = cents. 0 < x < 1 cent rounds up so it never shows as 0. */
const FIXED_POINT_PER_CENT = 1_000_000;

function fixedPointToCents(value: number): number {
  const cents = value / FIXED_POINT_PER_CENT;
  if (cents > 0 && cents < 1) return 1;
  return Math.round(cents);
}

/** `{ priceInCents, currency }` — already cents, do not divide again. */
function toMoney(raw: unknown): { cents: number; currency: string } | null {
  if (!isRecord(raw)) return null;
  const cents = toInt(raw["priceInCents"]);
  if (cents === null) return null;
  const currency = raw["currency"];
  return { cents, currency: typeof currency === "string" ? currency : "" };
}

function toExtraUsage(raw: unknown): ExtraUsage | null {
  if (!isRecord(raw)) return null;
  const balance = raw["balance"];
  if (!isRecord(balance) || balance["type"] !== "BOOSTER") return null;
  const amount = toInt(balance["amount"]);
  if (amount === null || amount <= 0) return null;
  const amountLeft = toInt(balance["amountLeft"]);
  const monthlyLimit = toMoney(raw["monthlyChargeLimit"]);
  const monthlyUsed = toMoney(raw["monthlyUsed"]);
  const currency = monthlyLimit?.currency || monthlyUsed?.currency || "USD";
  return {
    balanceCents: amountLeft === null ? 0 : fixedPointToCents(amountLeft),
    totalCents: fixedPointToCents(amount),
    monthlyChargeLimitEnabled: raw["monthlyChargeLimitEnabled"] === true,
    monthlyChargeLimitCents: monthlyLimit?.cents ?? 0,
    monthlyUsedCents: monthlyUsed?.cents ?? 0,
    currency,
  };
}

/** Wire format (SPEC §2.2) → normalised QuotaData. Lenient: missing pieces degrade to null/[]. */
export function parseUsages(wire: unknown): QuotaData {
  if (!isRecord(wire)) return { summary: null, limits: [], extraUsage: null };
  const rawSummary = wire["usage"];
  // The top-level usage block has no window on the wire; it is the weekly quota (SPEC §2.2).
  const summaryWindow = isRecord(rawSummary) ? (toWindow(rawSummary["window"]) ?? { duration: 1, unit: "week" as const }) : undefined;
  const summary = toRow(rawSummary, summaryWindow, isRecord(rawSummary) ? rawSummary["name"] : undefined);
  const limits: QuotaRow[] = [];
  const rawLimits = wire["limits"];
  if (Array.isArray(rawLimits)) {
    for (const item of rawLimits) {
      if (!isRecord(item)) continue;
      const row = toRow(item["detail"], toWindow(item["window"]), item["name"]);
      if (row) limits.push(row);
    }
  }
  return { summary, limits, extraUsage: toExtraUsage(wire["boosterWallet"]) };
}
