import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** `board.mjs set` says what a change of type took away. */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

const plain = { startAt: null, targetAt: null, shippedAt: null, note: null };
const BOARD = {
  project: { id: "p1", name: "Demo", key: "T" },
  properties: [
    {
      id: "p-type",
      name: "Type",
      type: "select",
      config: {},
      options: [
        { id: "o-bug", name: "Bug", ...plain },
        { id: "o-story", name: "Story", ...plain },
      ],
    },
  ],
  members: [],
  tasks: [{ id: "t1", key: "T-1", title: "One", values: { "p-type": "o-bug" } }],
  runs: [],
};

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function run(dropped: { taskId: string; propertyId: string; name: string }[]) {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const body =
        req.url === "/api/agent/me"
          ? { agent: { name: "Scribe" }, project: { id: "p1" } }
          : req.url === "/api/projects/p1/board"
            ? BOARD
            : req.url === "/api/tasks/t1/values/p-type"
              ? { value: "o-story", dropped }
              : {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return new Promise<{ code: number | null; out: string }>((done) => {
    const child = spawn(process.execPath, [BOARD_MJS, "set", "T-1", "Type", "Story"], {
      env: { ...process.env, USHABTI_URL: `http://127.0.0.1:${port}`, USHABTI_TOKEN: "ush_test" },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => done({ code, out }));
  });
}

describe("board.mjs set", () => {
  it("prints the values the change dropped", async () => {
    const { code, out } = await run([
      { taskId: "t1", propertyId: "p-sev", name: "Severity" },
      { taskId: "t1", propertyId: "p-repro", name: "Repro" },
    ]);
    expect(code).toBe(0);
    expect(out).toContain("T-1: Type = Story");
    expect(out).toContain("T-1: dropped Severity, Repro (no longer shown)");
  });

  it("prints nothing more when nothing went", async () => {
    const { code, out } = await run([]);
    expect(code).toBe(0);
    expect(out).not.toContain("dropped");
  });
});
