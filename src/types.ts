/** Normalised quota model (cache schema, SPEC §4). Not the wire format. */

export type TimeUnit = "minute" | "hour" | "day" | "week";

export interface QuotaWindow {
  duration: number;
  unit: TimeUnit;
}

export interface QuotaRow {
  name: string;
  window?: QuotaWindow;
  used: number;
  limit: number;
  resetAt?: string;
}

export interface ExtraUsage {
  balanceCents: number;
  totalCents: number;
  monthlyChargeLimitEnabled: boolean;
  monthlyChargeLimitCents: number;
  monthlyUsedCents: number;
  currency: string;
}

export interface QuotaData {
  summary: QuotaRow | null;
  limits: QuotaRow[];
  extraUsage: ExtraUsage | null;
}

/** Fields kimi-code feeds on stdin (StatusLinePayload). All optional: parse loosely. */
export interface StatusLinePayload {
  model?: string;
  cwd?: string;
  gitBranch?: string | null;
  permissionMode?: string;
  planMode?: boolean;
  contextUsage?: number;
  contextTokens?: number;
  maxContextTokens?: number;
  sessionId?: string;
  version?: string;
}

export type CacheErrorCode = "no-auth" | "expired" | "invalid-credential" | "network" | "http" | "bad-response";

/** On-disk cache (SPEC §4): normalised quota plus fetch metadata. */
export interface QuotaCache extends QuotaData {
  schemaVersion: 1;
  /** Unix ms of the last *successful* fetch that produced summary/limits. */
  fetchedAt: number;
  /** Unix ms of the last refresh attempt, successful or not; throttles re-spawns. */
  attemptedAt: number;
  baseUrl: string;
  ok: boolean;
  error: string | null;
  errorCode: CacheErrorCode | null;
}
