import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The project's rules reach an agent through the claim, so `claim` prints
 * them and the watcher puts them into the harness prompt.
 */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

const RULES = {
  text: "Review means the option In review.\nAsk before you estimate.",
  hash: "abc123",
};
const ME = {
  agent: { id: "a1", name: "Scribe" },
  project: { id: "p1", name: "Demo", key: "T" },
};
const BOARD = {
  project: { id: "p1", name: "Demo", key: "T" },
  tasks: [{ id: "t1", key: "T-1", values: {} }],
  properties: [],
  runs: [],
  archived: [],
};
const CREATED = {
  id: "e1",
  kind: "created",
  taskId: "t1",
  taskKey: "T-1",
  actor: { id: "u1", kind: "human" },
  data: { title: "A task" },
  createdAt: "2026-01-01T00:00:01.000Z",
};

let server: Server | null = null;

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = null;
});

async function fakeBoard(rules: unknown): Promise<string> {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on("end", () => {
      const url = req.url ?? "";
      if (url === "/api/projects/p1/stream") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write("event: ready\ndata: {}\n\n");
        return;
      }
      let body: unknown = {};
      if (url === "/api/agent/me") body = ME;
      else if (url === "/api/projects/p1/board") body = BOARD;
      else if (url === "/api/projects/p1/activity") body = { now: "2026-01-01T00:00:00.000Z" };
      else if (url.startsWith("/api/projects/p1/activity?")) body = { entries: [CREATED] };
      else if (url === "/api/tasks/t1/run") body = { run: { id: "r1" }, rules };
      else if (url === "/api/runs/r1") body = { run: { id: "r1", status: "done", endedAt: "x" } };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
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

describe("the rules of a board", () => {
  it("claim prints them with their hash", async () => {
    const url = await fakeBoard(RULES);
    const result = await runBoard(url, "claim", "T-1", "--goal", "Build it");
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("T-1 claimed. run r1");
    expect(result.out).toContain("The rules of this board (abc123)");
    expect(result.out).toContain(RULES.text);
  });

  it("claim prints nothing more when the project wrote none", async () => {
    const url = await fakeBoard({ text: "", hash: "e3b0c44298fc" });
    const result = await runBoard(url, "claim", "T-1");
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("The rules of this board");
  });

  it("the watcher puts them into the prompt", async () => {
    const url = await fakeBoard(RULES);
    const result = await runBoard(
      url,
      "watch",
      "--on",
      "created",
      "--once",
      "--run",
      "printf '%s\\n' {prompt}",
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain("[T-1] A person just created task T-1");
    expect(result.out).toContain("[T-1] The rules of this board (abc123)");
    expect(result.out).toContain("[T-1] Ask before you estimate.");
  }, 20_000);
});
