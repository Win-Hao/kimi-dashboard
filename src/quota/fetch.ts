export interface FetchUsagesOptions {
  baseUrl: string;
  accessToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type FetchUsagesResult =
  | { kind: "ok"; wire: unknown }
  | { kind: "error"; code: "network" | "http" | "bad-response"; status?: number; message: string };

export const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

/** One GET {base}/usages. Error messages never include the token. */
export async function fetchUsages(options: FetchUsagesOptions): Promise<FetchUsagesResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/usages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${options.accessToken}`, Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return { kind: "error", code: "network", message: aborted ? "request timed out" : describe(error) };
    }
    if (!response.ok) {
      return { kind: "error", code: "http", status: response.status, message: `HTTP ${response.status}` };
    }
    try {
      return { kind: "ok", wire: await response.json() };
    } catch {
      return { kind: "error", code: "bad-response", status: response.status, message: "response was not JSON" };
    }
  } finally {
    clearTimeout(timer);
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const code = cause instanceof Error && "code" in cause ? String((cause as { code?: unknown }).code) : undefined;
    return code ? `${error.message} (${code})` : error.message;
  }
  return String(error);
}
