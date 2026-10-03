import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `board.mjs` writing and reading a Link property, against a board that
 * remembers what was put and answers it back.
 */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

const PR = "https://github.com/acme/shop/pull/12";
const OTHER = "https://github.com/acme/shop/pull/13";

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

async function fakeBoard(links: string[]) {
  const puts: unknown[] = [];
  let held = links;
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: unknown = {};
      if (req.url === "/api/agent/me") body = { agent: { name: "Scribe" }, project: { id: "p1" } };
      else if (req.url === "/api/projects/p1/board") {
        body = {
          project: { id: "p1", name: "Demo", key: "T" },
          properties: [{ id: "p-prs", name: "Pull requests", type: "link", options: [] }],
          members: [],
          tasks: [{ id: "t1", key: "T-1", values: { "p-prs": held } }],
          runs: [],
          archived: [],
        };
      } else if (req.url === "/api/tasks/t1") {
        body = {
          task: {
            title: "Ship it",
            description: "",
            values: { "p-prs": held },
            checklist: [],
            comments: [],
          },
        };
      } else if (req.method === "PUT" && req.url === "/api/tasks/t1/values/p-prs") {
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

describe("board.mjs and a Link property", () => {
  it("set replaces the list with the links it is given", async () => {
    const { url, puts } = await fakeBoard(["https://example.org/old"]);
    const result = await runBoard(url, "set", "T-1", "Pull requests", `${PR}, ${OTHER}`);
    expect(result.err).toBe("");
    expect(puts).toEqual([[PR, OTHER]]);
  });

  it("set none empties the list", async () => {
    const { url, puts } = await fakeBoard([PR]);
    await runBoard(url, "set", "T-1", "Pull requests", "none");
    expect(puts).toEqual([[]]);
  });

  it("--add keeps the links already there", async () => {
    const { url, puts } = await fakeBoard([PR]);
    const result = await runBoard(url, "set", "T-1", "Pull requests", "--add", OTHER);
    expect(result.err).toBe("");
    expect(puts).toEqual([[PR, OTHER]]);
  });

  it("task prints each link whole, on a line of its own", async () => {
    const { url } = await fakeBoard([PR, OTHER]);
    const result = await runBoard(url, "task", "T-1");
    expect(result.out).toContain(`  Pull requests:\n    ${PR}\n    ${OTHER}\n`);
  });
});
