import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `board.mjs` making a task part of another, taking it out again, and printing
 * both sides, against a board that records what was asked.
 */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

const row = (id: string, key: string, title: string, over = false) => ({ id, key, title, over });

async function fakeBoard() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: unknown = { ok: true };
      if (req.url === "/api/agent/me") body = { agent: { name: "Scribe" }, project: { id: "p1" } };
      else if (req.url === "/api/projects/p1/board") {
        body = {
          project: { id: "p1", name: "Demo", key: "T" },
          properties: [],
          members: [],
          tasks: [
            { id: "t1", key: "T-1", values: {} },
            { id: "t2", key: "T-2", values: {} },
          ],
          runs: [],
          archived: [],
        };
      } else if (req.method === "GET" && req.url === "/api/tasks/t1") {
        body = {
          task: {
            title: "Ship it",
            description: "",
            values: {},
            checklist: [],
            comments: [],
            links: { blockedBy: [], blocks: [] },
            parent: row("t9", "T-9", "The epic"),
            children: [],
          },
        };
      } else if (req.method === "GET" && req.url === "/api/tasks/t2") {
        body = {
          task: {
            title: "The whole",
            description: "",
            values: {},
            checklist: [],
            comments: [],
            links: { blockedBy: [], blocks: [] },
            parent: null,
            children: [row("t3", "T-3", "First part", true), row("t4", "T-4", "Second part")],
          },
        };
      } else {
        calls.push({
          method: req.method ?? "",
          url: req.url ?? "",
          body: raw ? JSON.parse(raw) : null,
        });
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

describe("board.mjs and a parent", () => {
  it("parent makes the first task part of the second", async () => {
    const { url, calls } = await fakeBoard();
    const result = await runBoard(url, "parent", "T-1", "T-2");
    expect(result.err).toBe("");
    expect(calls).toEqual([
      { method: "PUT", url: "/api/tasks/t1/parent", body: { parentId: "t2" } },
    ]);
    expect(result.out).toContain("T-1 is part of T-2");
  });

  it("unparent takes the task out of its parent", async () => {
    const { url, calls } = await fakeBoard();
    const result = await runBoard(url, "unparent", "T-1");
    expect(result.err).toBe("");
    expect(calls).toEqual([{ method: "DELETE", url: "/api/tasks/t1/parent", body: null }]);
  });

  it("task prints the parent of a part", async () => {
    const { url } = await fakeBoard();
    const result = await runBoard(url, "task", "T-1");
    expect(result.out).toContain("  Parent: T-9 The epic\n");
  });

  it("task prints the children, an over one said to be over", async () => {
    const { url } = await fakeBoard();
    const result = await runBoard(url, "task", "T-2");
    expect(result.out).toContain("  Children: T-3 (over) First part, T-4 Second part\n");
  });
});
