import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** `board.mjs watch` decides from the line whom it is for, and reads the
    board only for a line from a board too old to say. */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

const AGENT = "u-agent";
const BOARD = {
  project: { id: "p1", name: "Demo", key: "T" },
  properties: [
    { id: "p-who", name: "Assignee", type: "person", config: {}, options: [] },
    { id: "p-status", name: "Status", type: "select", config: {}, options: [] },
  ],
  members: [],
  tasks: [{ id: "t1", key: "T-1", title: "One", values: { "p-who": AGENT } }],
  runs: [],
};

type Line = { kind: string; data: Record<string, unknown>; actorKind?: string };

let server: Server | null = null;
let child: ReturnType<typeof spawn> | null = null;
afterEach(() => {
  child?.kill("SIGKILL");
  child = null;
  server?.close();
  server = null;
});

/** Runs the watcher over one page of lines and counts its reads of the board. */
async function watch(lines: Line[]) {
  let boardReads = 0;
  let pages = 0;
  let paged: () => void = () => {};
  const read = new Promise<void>((done) => (paged = done));
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const url = req.url ?? "";
      if (url.endsWith("/stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write("event: ready\ndata: {}\n\n");
        return;
      }
      let body: unknown = {};
      if (url === "/api/agent/me") {
        body = {
          agent: { id: AGENT, name: "Reis" },
          project: { id: "p1", name: "Demo", key: "T" },
        };
      } else if (url === "/api/projects/p1/board") {
        boardReads++;
        body = BOARD;
      } else if (url === "/api/projects/p1/activity") {
        body = { entries: [], now: "2026-10-08T10:00:00.000Z" };
      } else if (url.startsWith("/api/projects/p1/activity?")) {
        pages++;
        body = {
          entries:
            pages === 1
              ? lines.map((l, i) => ({
                  id: `a${i}`,
                  kind: l.kind,
                  taskId: "t1",
                  taskKey: "T-1",
                  data: l.data,
                  createdAt: "2026-10-08T10:00:01.000Z",
                  actor: { id: "u-person", name: "Ada", kind: l.actorKind ?? "human" },
                }))
              : [],
        };
        setTimeout(paged, 100);
      } else {
        // The claim: refused, so the harness never starts.
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Held." }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  child = spawn(process.execPath, [BOARD_MJS, "watch", "--run", "exit 0"], {
    env: { ...process.env, USHABTI_URL: `http://127.0.0.1:${port}`, USHABTI_TOKEN: "ush_test" },
  });
  let out = "";
  child.stdout!.on("data", (chunk) => (out += chunk));
  child.stderr!.on("data", (chunk) => (out += chunk));
  await read;
  return { boardReads, out };
}

const value = (data: Record<string, unknown>): Line => ({ kind: "value", data });

describe("board.mjs watch", () => {
  it("reads nothing for a card dragged across a status column", async () => {
    const { boardReads, out } = await watch([
      value({ property: "Status", propertyId: "p-status", type: "select", value: "Doing" }),
    ]);
    expect(boardReads).toBe(0);
    expect(out).not.toContain("T-1: assigned");
  });

  it("wakes on a person line that names it, without reading the board", async () => {
    const { boardReads, out } = await watch([
      value({
        property: "Assignee",
        propertyId: "p-who",
        type: "person",
        value: AGENT,
        personId: AGENT,
      }),
    ]);
    expect(boardReads).toBe(0);
    expect(out).toContain("T-1: assigned");
  });

  it("sleeps on a person line that names somebody else", async () => {
    const { boardReads, out } = await watch([
      value({ propertyId: "p-who", type: "person", value: "u-ada", personId: "u-ada" }),
      value({ propertyId: "p-who", type: "person", value: "empty", personId: null }),
    ]);
    expect(boardReads).toBe(0);
    expect(out).not.toContain("T-1: assigned");
  });

  it("reads nothing for a line about values a change hid", async () => {
    const { boardReads } = await watch([
      value({ dropped: ["Severity"], propertyIds: ["p-sev"], hidBy: "Type" }),
    ]);
    expect(boardReads).toBe(0);
  });

  it("wakes on a new task that names it, without reading the board", async () => {
    const { boardReads, out } = await watch([
      { kind: "created", data: { title: "One", assigneeIds: [AGENT] }, actorKind: "agent" },
    ]);
    expect(boardReads).toBe(0);
    expect(out).toContain("T-1: assigned");
  });

  it("asks the board for a line from an older board, and still wakes", async () => {
    const { boardReads, out } = await watch([
      value({ property: "Status", propertyId: "p-status", value: "Doing" }),
      value({ property: "Assignee", propertyId: "p-who", value: AGENT }),
    ]);
    // Once a pass, however many lines need it.
    expect(boardReads).toBe(1);
    expect(out).toContain("T-1: assigned");
  });

  it("asks the board for a created line that names nobody", async () => {
    const { boardReads, out } = await watch([
      { kind: "created", data: { title: "One" }, actorKind: "agent" },
    ]);
    expect(boardReads).toBe(1);
    expect(out).toContain("T-1: assigned");
  });
});
