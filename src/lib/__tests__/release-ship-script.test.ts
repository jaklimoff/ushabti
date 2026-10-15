import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `.setmaat/release/ship.sh`, the release.after of Setmaat's release program,
 * against a board that records what was asked. It dates the release to today
 * and ships it, so one press of Release leaves it shipped on the board.
 */
const SHIP_SH = path.resolve(process.cwd(), ".setmaat/release/ship.sh");

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

type Option = { id: string; name: string; startAt: string | null; targetAt: string | null };

async function fakeBoard({ refuse = false } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const releases: Option[] = [{ id: "o25", name: "0.25.0", startAt: null, targetAt: "2026-10-01" }];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const sent = raw ? JSON.parse(raw) : null;
      let status = 200;
      let body: unknown = { ok: true };
      if (req.url === "/api/agent/me") body = { agent: { name: "Loop" }, project: { id: "p1" } };
      else if (req.url === "/api/projects/p1/board") {
        body = {
          project: { id: "p1", name: "Ushabti", key: "USH", releaseBy: "rel" },
          properties: [{ id: "rel", name: "Release", type: "select", options: releases }],
          members: [],
          tasks: [],
          runs: [],
          archived: [],
        };
      } else {
        calls.push({ method: req.method ?? "", url: req.url ?? "", body: sent });
        if (req.url === "/api/properties/rel/options") {
          releases.push({ id: `o${releases.length}`, startAt: null, targetAt: null, ...sent });
        } else if (req.url?.endsWith("/ship")) {
          if (refuse) {
            status = 409;
            body = { error: "This release is shipped already." };
          } else {
            body = { archived: 4, moved: 0, rest: sent.rest, shippedAt: "2026-10-15", taken: 2 };
          }
        }
      }
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls };
}

function runShip(env: Record<string, string | undefined>) {
  return new Promise<{ code: number | null; out: string; err: string }>((done) => {
    const child = spawn("sh", [SHIP_SH], {
      env: {
        ...process.env,
        USHABTI_URL: undefined,
        USHABTI_TOKEN: undefined,
        SETMAAT_RELEASE_VERSION: "0.26.0",
        ...env,
      },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => done({ code, out, err }));
  });
}

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe("ship.sh", () => {
  it("dates the release to today, ships it with the strays, and prints the answer", async () => {
    const { url, calls } = await fakeBoard();
    const result = await runShip({ USHABTI_URL: url, USHABTI_TOKEN: "ush_test" });
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(calls).toEqual([
      {
        method: "POST",
        url: "/api/properties/rel/options",
        body: { name: "0.26.0", targetAt: today() },
      },
      { method: "POST", url: "/api/options/o1/ship", body: { rest: "leave", strays: true } },
    ]);
    expect(result.out).toBe(
      `Release 0.26.0 made, due ${today()}\n` +
        "Release 0.26.0 shipped 2026-10-15: 4 archived, 0 moved, 2 taken from no release\n",
    );
  });

  it("refuses with one sentence when the token is missing, and asks the board nothing", async () => {
    const { url, calls } = await fakeBoard();
    const result = await runShip({ USHABTI_URL: url });
    expect(result.code).toBe(1);
    expect(result.err).toBe(
      "ship.sh: USHABTI_TOKEN is not set, so 0.26.0 was not shipped on the board.\n",
    );
    expect(calls).toEqual([]);
  });

  it("refuses with one sentence when the board refuses the ship", async () => {
    const { url } = await fakeBoard({ refuse: true });
    const result = await runShip({ USHABTI_URL: url, USHABTI_TOKEN: "ush_test" });
    expect(result.code).toBe(1);
    expect(result.err).toBe(
      "ship.sh: the board refused to ship 0.26.0 (409: This release is shipped already.), " +
        "and nothing before this step is undone.\n",
    );
  });
});
