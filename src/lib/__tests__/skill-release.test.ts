import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `board.mjs` making a release, dating it, and shipping it, against a board
 * that keeps its options and records what was asked. A plain select named
 * Version stands beside the releases, so a name is looked up under the
 * property `releaseBy` points to and nowhere else.
 */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

type Option = { id: string; name: string; startAt: string | null; targetAt: string | null };

async function fakeBoard({ releaseBy = "rel" as string | null } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const releases: Option[] = [{ id: "o25", name: "0.25.0", startAt: null, targetAt: "2026-10-14" }];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const sent = raw ? JSON.parse(raw) : null;
      let body: unknown = { ok: true };
      if (req.url === "/api/agent/me") body = { agent: { name: "Scribe" }, project: { id: "p1" } };
      else if (req.url === "/api/projects/p1/board") {
        body = {
          project: { id: "p1", name: "Demo", key: "T", releaseBy },
          properties: [
            {
              id: "ver",
              name: "Version",
              type: "select",
              options: [{ id: "x25", name: "0.25.0" }],
            },
            { id: "rel", name: "Release", type: "select", options: releases },
          ],
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
          body = { archived: 3, moved: 1, rest: sent.rest, shippedAt: "2026-10-15", taken: 0 };
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls };
}

function runBoard(url: string, ...args: string[]) {
  return new Promise<{ code: number | null; out: string; err: string }>((done) => {
    const child = spawn(process.execPath, [BOARD_MJS, ...args], {
      env: { ...process.env, USHABTI_URL: url, USHABTI_TOKEN: "ush_test" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => done({ code, out, err }));
  });
}

describe("board.mjs ship", () => {
  it("ships the release of that name, and prints what the route answered", async () => {
    const { url, calls } = await fakeBoard();
    const result = await runBoard(url, "ship", "0.25.0", "--rest", "leave");
    expect(result.err).toBe("");
    expect(calls).toEqual([
      { method: "POST", url: "/api/options/o25/ship", body: { rest: "leave" } },
    ]);
    expect(result.out).toBe("Release 0.25.0 shipped 2026-10-15: 3 archived, 1 moved\n");
  });

  it("sends strays when asked", async () => {
    const { url, calls } = await fakeBoard();
    await runBoard(url, "ship", "0.25.0", "--strays", "--rest", "next");
    expect(calls[0].body).toEqual({ rest: "next", strays: true });
  });

  it("asks for the rest before anything is sent", async () => {
    const { url, calls } = await fakeBoard();
    const result = await runBoard(url, "ship", "0.25.0");
    expect(result.code).toBe(1);
    expect(result.err).toContain("--rest next, --rest leave or --rest clear");
    expect(calls).toEqual([]);
  });

  it("says so on a board with releases off", async () => {
    const { url, calls } = await fakeBoard({ releaseBy: null });
    const result = await runBoard(url, "ship", "0.25.0", "--rest", "leave");
    expect(result.code).toBe(1);
    expect(result.err).toContain("This board has no releases.");
    expect(calls).toEqual([]);
  });
});

describe("board.mjs release", () => {
  it("makes the option when it is missing, and run again sets its dates", async () => {
    const { url, calls } = await fakeBoard();
    const made = await runBoard(url, "release", "0.26.0", "--target", "2026-11-01");
    expect(made.err).toBe("");
    expect(made.out).toBe("Release 0.26.0 made, due 2026-11-01\n");

    const dated = await runBoard(
      url,
      "release",
      "0.26.0",
      "--target",
      "2026-11-08",
      "--start",
      "2026-10-20",
    );
    expect(dated.err).toBe("");
    expect(dated.out).toBe("Release 0.26.0 dated 2026-10-20 → 2026-11-08\n");

    expect(calls).toEqual([
      {
        method: "POST",
        url: "/api/properties/rel/options",
        body: { name: "0.26.0", targetAt: "2026-11-01" },
      },
      {
        method: "PATCH",
        url: "/api/options/o1",
        body: { targetAt: "2026-11-08", startAt: "2026-10-20" },
      },
    ]);
  });

  it("refuses a day that is not one before anything is sent", async () => {
    const { url, calls } = await fakeBoard();
    const result = await runBoard(url, "release", "0.26.0", "--target", "1 Nov");
    expect(result.code).toBe(1);
    expect(result.err).toContain("--target must be a day like 2026-11-01.");
    expect(calls).toEqual([]);
  });
});
