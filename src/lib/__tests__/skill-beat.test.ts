import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `board.mjs beat` killed with its session. Was e2e/agents.spec.ts "a beat
 * killed after a hand-over leaves the run alone" and "a beat killed after a
 * question leaves the run alone": the heartbeat reads the run before it
 * writes, so a run that waits on purpose is left as its agent left it. The
 * route's own door is "the board refuses a lost report on a run that waits"
 * in agents-route.test.ts.
 */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

type Seen = { method: string; url: string; body: unknown }[];

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

/** A board with one task, T-1, whose open run stands at `status`. */
async function fakeBoard(status: string): Promise<{ url: string; seen: Seen }> {
  const seen: Seen = [];
  const answers: Record<string, unknown> = {
    "/api/agent/me": { agent: { name: "Beater" }, project: { id: "p1" } },
    "/api/projects/p1/board": {
      project: { id: "p1", name: "Demo", key: "T" },
      tasks: [{ id: "t1", key: "T-1" }],
      runs: [{ id: "r1", taskId: "t1", status }],
      archived: [],
    },
    "/api/runs/r1": { run: { id: "r1", status } },
  };
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", body: raw && JSON.parse(raw) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify((req.method === "GET" && answers[req.url ?? ""]) || {}));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen };
}

/** Starts the heartbeat, waits until it beats, then kills it as a shell would. */
function beatThenKill(url: string) {
  return new Promise<{ code: number | null; out: string }>((done) => {
    const child = spawn(
      process.execPath,
      [BOARD_MJS, "beat", "T-1", "--every", "15", "--for", "1"],
      {
        env: { ...process.env, USHABTI_URL: url, USHABTI_TOKEN: "ush_test" },
      },
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.includes("beating for T-1")) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => done({ code, out }));
  });
}

const lost = (seen: Seen) =>
  seen.filter((s) => s.method === "PATCH" && (s.body as { status?: string }).status === "lost");

describe("board.mjs beat, killed with its session", () => {
  for (const [what, status] of [
    ["a hand-over", "handed_over"],
    ["a question", "waiting"],
  ]) {
    it(`a beat killed after ${what} leaves the run alone`, async () => {
      const { url, seen } = await fakeBoard(status);
      const result = await beatThenKill(url);
      expect(result.code, result.out).toBe(0);
      expect(seen.some((s) => s.method === "GET" && s.url === "/api/runs/r1")).toBe(true);
      expect(lost(seen)).toEqual([]);
    });
  }

  // The usual death: killed mid-step, so the card comes back at once.
  it("a beat killed while the run is running closes it", async () => {
    const { url, seen } = await fakeBoard("running");
    const result = await beatThenKill(url);
    expect(result.code, result.out).toBe(0);
    expect(lost(seen)).toEqual([
      {
        method: "PATCH",
        url: "/api/runs/r1",
        body: { status: "lost", log: "the agent was stopped" },
      },
    ]);
  });
});
