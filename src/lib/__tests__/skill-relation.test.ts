import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `board.mjs` writing and reading a Tasks property by key, against a board that
 * remembers what was put and answers it back.
 */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

const DUP = { id: "p-dup", name: "Duplicate of", type: "relation", options: [], config: {} };
const NAMED = { ...DUP, config: { reverseName: "Duplicated by" } };

async function fakeBoard(held: string[], property = DUP) {
  const puts: unknown[] = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: unknown = {};
      if (req.url === "/api/agent/me") body = { agent: { name: "Scribe" }, project: { id: "p1" } };
      else if (req.url === "/api/projects/p1/board") {
        body = {
          project: { id: "p1", name: "Demo", key: "T" },
          properties: [property],
          members: [],
          tasks: [
            { id: "t1", key: "T-1", title: "One", values: { "p-dup": held } },
            { id: "t3", key: "T-3", title: "Three", values: {} },
            { id: "t7", key: "T-7", title: "Seven", values: {} },
          ],
          runs: [],
          archived: [{ id: "t9", key: "T-9", title: "Nine" }],
        };
      } else if (req.url === "/api/tasks/t1" || req.url === "/api/tasks/t3") {
        body = {
          task: {
            title: req.url.endsWith("t1") ? "One" : "Three",
            description: "",
            values: req.url.endsWith("t1") ? { "p-dup": held } : {},
            pointedBy: req.url.endsWith("t3")
              ? [
                  {
                    propertyId: "p-dup",
                    tasks: [
                      { id: "t1", key: "T-1", title: "One", archived: false },
                      { id: "t9", key: "T-9", title: "Nine", archived: true },
                    ],
                  },
                ]
              : [],
            checklist: [],
            comments: [],
          },
        };
      } else if (req.method === "PUT" && req.url === "/api/tasks/t1/values/p-dup") {
        const value = (JSON.parse(raw) as { value: string[] }).value;
        puts.push(value);
        held = value;
        body = { value };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, puts };
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

describe("board.mjs and a Tasks property", () => {
  it("set writes the tasks two keys name, in any case", async () => {
    const { url, puts } = await fakeBoard([]);
    const result = await runBoard(url, "set", "T-1", "Duplicate of", "t-3, T-7");
    expect(result.err).toBe("");
    expect(puts).toEqual([["t3", "t7"]]);
    expect(result.out).toContain("T-1: Duplicate of = T-3, T-7");
  });

  it("an empty value clears it", async () => {
    const { url, puts } = await fakeBoard(["t3"]);
    const result = await runBoard(url, "set", "T-1", "Duplicate of", "");
    expect(result.err).toBe("");
    expect(puts).toEqual([[]]);
  });

  it("--add keeps the tasks already there", async () => {
    const { url, puts } = await fakeBoard(["t3"]);
    await runBoard(url, "set", "T-1", "Duplicate of", "--add", "T-9");
    expect(puts).toEqual([["t3", "t9"]]);
  });

  it("an unknown key fails with a sentence naming it, and writes nothing", async () => {
    const { url, puts } = await fakeBoard(["t3"]);
    const result = await runBoard(url, "set", "T-1", "Duplicate of", "T-3, t-42");
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("No task T-42 on this board");
    expect(puts).toEqual([]);
  });

  it("task prints the value as keys, an archived one marked", async () => {
    const { url } = await fakeBoard(["t3", "t9"]);
    const result = await runBoard(url, "task", "T-1");
    expect(result.out).toContain("  Duplicate of: T-3, T-9 (archived)\n");
  });

  it("task prints the other side under its reverse name", async () => {
    const { url } = await fakeBoard([], NAMED);
    const result = await runBoard(url, "task", "T-3");
    expect(result.out).toContain("  Duplicated by: T-1 One, T-9 (archived) Nine\n");
  });
});
