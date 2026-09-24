import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `board.mjs` against a board that cuts the connection after the answer
 * began, which is what Node's fetch reports as "terminated".
 */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

const ME = { agent: { name: "Scribe" }, project: { id: "p1" } };
const BOARD = {
  project: { id: "p1", name: "Demo", key: "T" },
  tasks: [{ id: "t1", key: "T-1" }],
  runs: [],
  archived: [],
};

type Seen = { method: string; url: string }[];

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

/** A board whose `cut` requests lose their connection halfway through the answer. */
async function fakeBoard(cut: (seen: Seen) => boolean): Promise<{ url: string; seen: Seen }> {
  const seen: Seen = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "" });
      if (cut(seen)) {
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "100" });
        res.write('{"half":', () => res.socket?.destroy());
        return;
      }
      const body =
        req.url === "/api/agent/me" ? ME : req.url === "/api/projects/p1/board" ? BOARD : {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen };
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

const count = (seen: Seen, method: string, url: string) =>
  seen.filter((s) => s.method === method && s.url === url).length;

describe("board.mjs on a dropped connection", () => {
  it("reads once more and succeeds", async () => {
    const { url, seen } = await fakeBoard((s) => count(s, "GET", "/api/agent/me") === 1);
    const result = await runBoard(url, "me");
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("Scribe on Demo (T)");
    expect(count(seen, "GET", "/api/agent/me")).toBe(2);
  });

  it("reads only once more, then says why", async () => {
    const { url, seen } = await fakeBoard((s) => s.at(-1)?.url === "/api/agent/me");
    const result = await runBoard(url, "me");
    expect(result.code).toBe(1);
    expect(result.err).toContain("did not answer: terminated");
    expect(count(seen, "GET", "/api/agent/me")).toBe(2);
  });

  it("never sends a write twice", async () => {
    const { url, seen } = await fakeBoard((s) => s.at(-1)?.method === "POST");
    const result = await runBoard(url, "comment", "T-1", "the tests pass");
    expect(result.code).toBe(1);
    expect(result.err).toContain("did not answer: terminated");
    expect(count(seen, "POST", "/api/tasks/t1/comments")).toBe(1);
  });
});
