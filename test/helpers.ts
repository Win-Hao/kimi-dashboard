import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
}

export interface UsagesServer {
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

export type Responder = (req: IncomingMessage) => { status: number; body: string; delayMs?: number };

/** A real loopback HTTP server standing in for api.kimi.com/coding/v1. */
export async function startUsagesServer(respond: Responder): Promise<UsagesServer> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
    const { status, body, delayMs } = respond(req);
    setTimeout(() => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    }, delayMs ?? 0);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/coding/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function tempDir(prefix = "kimi-dashboard-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A fake KIMI_CODE_HOME with an optional credential file (null/undefined → none). */
export function makeKimiHome(credential?: unknown, name = "kimi-code"): string {
  const home = tempDir("kimi-home-");
  if (credential !== undefined && credential !== null) {
    mkdirSync(join(home, "credentials"), { mode: 0o700 });
    writeFileSync(join(home, "credentials", `${name}.json`), JSON.stringify(credential), { mode: 0o600 });
  }
  return home;
}
