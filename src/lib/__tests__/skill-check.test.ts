import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * What `board.mjs` decides before it writes: which checklist item its words
 * name, and whether a hand-over names anybody. Was e2e/listening.spec.ts
 * "board.mjs adds an item, ticks the one its words name, and refuses to guess
 * or to take an empty term", and the client's door of "a run hands the task
 * on, and the next claim closes it". The route's door is runs-route.test.ts.
 */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

type Item = { id: string; text: string; done: boolean };
type Seen = { method: string; url: string; body: unknown }[];

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

/** A board with one task, T-1, an open run, and a checklist the board keeps. */
async function fakeBoard(): Promise<{ url: string; seen: Seen; items: Item[] }> {
  const seen: Seen = [];
  const items: Item[] = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const url = req.url ?? "";
      seen.push({ method: req.method ?? "", url, body });
      let answer: unknown = {};
      if (url === "/api/agent/me") answer = { agent: { name: "Ticker" }, project: { id: "p1" } };
      else if (url === "/api/projects/p1/board") {
        answer = {
          project: { id: "p1", name: "Demo", key: "T" },
          tasks: [{ id: "t1", key: "T-1" }],
          runs: [{ id: "r1", taskId: "t1", status: "running" }],
          archived: [],
        };
      } else if (url === "/api/tasks/t1") answer = { task: { checklist: items } };
      else if (req.method === "POST" && url === "/api/tasks/t1/checklist") {
        items.push({ id: `i${items.length + 1}`, text: body.text, done: false });
      } else if (req.method === "PATCH" && url.startsWith("/api/checklist/")) {
        const item = items.find((i) => url.endsWith(`/${i.id}`));
        if (item) item.done = body.done;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, items };
}

function runBoard(url: string, ...args: string[]) {
  return new Promise<{ code: number | null; output: string }>((done) => {
    const child = spawn(process.execPath, [BOARD_MJS, ...args], {
      env: { ...process.env, USHABTI_URL: url, USHABTI_TOKEN: "ush_test" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => done({ code, output }));
  });
}

describe("An agent's checklist", () => {
  it("board.mjs adds an item, ticks the one its words name, and refuses to guess or to take an empty term", async () => {
    const { url, items } = await fakeBoard();
    const state = () => Object.fromEntries(items.map((i) => [i.text, i.done]));

    for (const text of ["A failed send retries five times", "A failed send gives up"]) {
      const added = await runBoard(url, "check", "T-1", text);
      expect(added.code, added.output).toBe(0);
    }

    // The whole text is not needed — one part that fits only one item is.
    const ticked = await runBoard(url, "check", "T-1", "retries five", "--done");
    expect(ticked.code, ticked.output).toBe(0);
    expect(state()).toEqual({
      "A failed send retries five times": true,
      "A failed send gives up": false,
    });

    // Both items carry these words, so they name neither, and nothing moves.
    const several = await runBoard(url, "check", "T-1", "A failed send", "--done");
    expect(several.code).toBe(1);
    expect(several.output).toContain("matches 2 items");
    const none = await runBoard(url, "check", "T-1", "the disk is full", "--done");
    expect(none.code).toBe(1);
    expect(none.output).toContain("A failed send gives up");

    const back = await runBoard(url, "check", "T-1", "retries five", "--undone");
    expect(back.code, back.output).toBe(0);
    expect(state()["A failed send retries five times"]).toBe(false);

    // A switch takes no value, so the flag may stand before the item as well.
    const flagFirst = await runBoard(url, "check", "T-1", "--done", "gives up");
    expect(flagFirst.code, flagFirst.output).toBe(0);
    expect(state()).toEqual({
      "A failed send retries five times": false,
      "A failed send gives up": true,
    });

    // Nothing is inside every item, so a term of only spaces is refused.
    const empty = await runBoard(url, "check", "T-1", " ", "--done");
    expect(empty.code).toBe(1);
    expect(empty.output).toContain("Give the item");
    expect(state()["A failed send gives up"]).toBe(true);
  });
});

describe("A hand-over", () => {
  it("to nobody is refused before anything is written", async () => {
    const { url, seen } = await fakeBoard();
    // `--to` with the next flag behind it reads as the word "true".
    for (const args of [
      ["--to", ""],
      ["--to", "--log", "x"],
    ]) {
      const refused = await runBoard(url, "finish", "T-1", ...args);
      expect(refused.code, refused.output).not.toBe(0);
      expect(refused.output).toContain("Give who has the task");
    }
    expect(seen.filter((s) => s.method !== "GET")).toEqual([]);

    const handed = await runBoard(url, "finish", "T-1", "--to", "review");
    expect(handed.code, handed.output).toBe(0);
    expect(handed.output).toContain("waiting for review");
    expect(seen.at(-1)).toMatchObject({
      method: "PATCH",
      url: "/api/runs/r1",
      body: { status: "handed_over", step: "review" },
    });
  });
});
