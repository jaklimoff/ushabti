import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** `board.mjs watch --view` keeps what waits in its state file, and on the
    next start lets it go or starts it from the view's queue alone. */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

const AGENT = "u-agent";
const VIEW = { id: "v-queue", name: "Agent queue" };

let server: Server | null = null;
let child: ReturnType<typeof spawn> | null = null;
afterEach(() => {
  child?.kill("SIGKILL");
  child = null;
  server?.close();
  server = null;
});

type World = {
  /** Who the task's assignee is, or no task at all: archived or deleted. */
  assignee?: string;
  /** What the view shows. */
  queue: string[];
  /** The view the saved holds were kept for. */
  heldFor?: string;
};

async function restart(world: World) {
  const state = path.join(mkdtempSync(path.join(os.tmpdir(), "ushabti-view-")), "watch.json");
  writeFileSync(
    state,
    JSON.stringify({
      projectId: "p1",
      cursor: "2026-11-09T10:00:00.000Z",
      seen: [],
      viewId: world.heldFor ?? VIEW.id,
      held: [{ taskId: "t1", key: "T-1", event: "assigned", told: true }],
    }),
  );
  const posts: string[] = [];
  let passes = 0;
  let passed: () => void = () => {};
  const done = new Promise<void>((resolve) => (passed = resolve));
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
        body = {
          views: [{ id: "v-board", name: "Board" }, VIEW],
          properties: [{ id: "p-who", name: "Assignee", type: "person", options: [] }],
          tasks: world.assignee
            ? [{ id: "t1", key: "T-1", title: "One", values: { "p-who": world.assignee } }]
            : [],
        };
      } else if (url === `/api/views/${VIEW.id}/tasks`) {
        body = { view: VIEW, tasks: world.queue.map((id) => ({ id, key: "T-1" })) };
      } else if (url.startsWith("/api/projects/p1/activity?")) {
        body = { entries: [] };
        // The pass ends after this page: give it a moment to write the state.
        if (++passes === 1) setTimeout(passed, 300);
      } else {
        // A comment or the claim: counted, then refused, so no harness starts.
        posts.push(`${req.method} ${url}`);
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
  child = spawn(
    process.execPath,
    [BOARD_MJS, "watch", "--run", "exit 0", "--view", "agent queue", "--state", state],
    { env: { ...process.env, USHABTI_URL: `http://127.0.0.1:${port}`, USHABTI_TOKEN: "ush_test" } },
  );
  let out = "";
  child.stdout!.on("data", (chunk) => (out += chunk));
  child.stderr!.on("data", (chunk) => (out += chunk));
  await done;
  const saved = JSON.parse(readFileSync(state, "utf8"));
  return { out, posts, held: saved.held as { taskId: string }[] };
}

describe("board.mjs watch --view", () => {
  it("starts a task held before a restart once the view shows it", async () => {
    const { out, posts, held } = await restart({ assignee: AGENT, queue: ["t1"] });
    expect(out).toContain("1 held");
    expect(out).toContain("T-1: assigned");
    expect(posts).toEqual(["POST /api/tasks/t1/run"]);
    expect(held).toEqual([]);
  });

  it("keeps a held task across a restart, and does not say it waits again", async () => {
    const { out, posts, held } = await restart({ assignee: AGENT, queue: [] });
    expect(out).not.toContain("T-1: assigned");
    expect(posts).toEqual([]);
    expect(held.map((h) => h.taskId)).toEqual(["t1"]);
  });

  it("lets a held task go when it is no longer assigned to the agent", async () => {
    const { out, posts, held } = await restart({ assignee: "u-ada", queue: ["t1"] });
    expect(out).toContain("T-1: no longer mine");
    expect(posts).toEqual([]);
    expect(held).toEqual([]);
  });

  it("lets a held task go when it is archived or deleted", async () => {
    const { out, posts, held } = await restart({ queue: [] });
    expect(out).toContain("T-1: archived or deleted");
    expect(posts).toEqual([]);
    expect(held).toEqual([]);
  });

  it("drops holds kept for another view", async () => {
    const { out, posts } = await restart({ assignee: AGENT, queue: ["t1"], heldFor: "v-other" });
    expect(out).toContain("0 held");
    expect(posts).toEqual([]);
  });
});
