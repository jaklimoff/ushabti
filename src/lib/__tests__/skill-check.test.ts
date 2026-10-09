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
          properties: [],
          tasks: [{ id: "t1", key: "T-1" }],
          runs: [{ id: "r1", taskId: "t1", status: "running" }],
          archived: [],
        };
      } else if (url === "/api/tasks/t1") {
        const task = { title: "Ship", description: "", values: {}, comments: [], checklist: items };
        answer = { task };
      } else if (req.method === "POST" && url === "/api/tasks/t1/checklist") {
        items.push({ id: `i${items.length + 1}`, text: body.text, done: false });
      } else if (req.method === "DELETE" && url.startsWith("/api/checklist/")) {
        const at = items.findIndex((i) => url.endsWith(`/${i.id}`));
        if (at >= 0) items.splice(at, 1);
      } else if (req.method === "PATCH" && url.startsWith("/api/checklist/")) {
        const item = items.find((i) => url.endsWith(`/${i.id}`));
        if (item && body.baseText !== undefined && body.baseText !== item.text) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "This changed while you typed.", current: item.text }));
          return;
        }
        if (item && body.done !== undefined) item.done = body.done;
        if (item && body.text !== undefined) item.text = body.text;
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

describe("Removing and rewording an item", () => {
  const add = async (url: string, ...texts: string[]) => {
    for (const text of texts) expect((await runBoard(url, "check", "T-1", text)).code).toBe(0);
  };

  it("task prints the checklist numbered from 1", async () => {
    const { url, items } = await fakeBoard();
    await add(url, "A failed send retries five times", "A failed send gives up");
    items[1].done = true;
    const shown = await runBoard(url, "task", "T-1");
    expect(shown.code, shown.output).toBe(0);
    expect(shown.output).toContain(
      "  1. [ ] A failed send retries five times\n  2. [x] A failed send gives up\n",
    );
  });

  it("check --remove deletes the one item its words name, and refuses to guess", async () => {
    const { url, items, seen } = await fakeBoard();
    await add(url, "A failed send retries five times", "A failed send gives up");

    const several = await runBoard(url, "check", "T-1", "A failed send", "--remove");
    expect(several.code).toBe(1);
    expect(several.output).toContain("matches 2 items");
    expect(seen.filter((s) => s.method === "DELETE")).toEqual([]);

    const removed = await runBoard(url, "check", "T-1", "--remove", "gives up");
    expect(removed.code, removed.output).toBe(0);
    expect(removed.output).toContain("removed");
    expect(items.map((i) => i.text)).toEqual(["A failed send retries five times"]);
  });

  it("check-rm deletes item n, and refuses a number it does not have", async () => {
    const { url, items } = await fakeBoard();
    await add(url, "First", "Second", "Third");

    const past = await runBoard(url, "check-rm", "T-1", "4");
    expect(past.code).toBe(1);
    expect(past.output).toContain("  3. [ ] Third");
    expect(items).toHaveLength(3);

    const removed = await runBoard(url, "check-rm", "T-1", "2");
    expect(removed.code, removed.output).toBe(0);
    expect(items.map((i) => i.text)).toEqual(["First", "Third"]);
  });

  it("check --rename rewords an item, sending the words it replaces", async () => {
    const { url, items, seen } = await fakeBoard();
    await add(url, "Retries work", "It gives up");

    const renamed = await runBoard(
      url,
      "check",
      "T-1",
      "Retries",
      "--rename",
      "A failed send retries five times",
    );
    expect(renamed.code, renamed.output).toBe(0);
    expect(items.map((i) => i.text)).toEqual(["A failed send retries five times", "It gives up"]);
    expect(seen.at(-1)).toMatchObject({
      method: "PATCH",
      body: { text: "A failed send retries five times", baseText: "Retries work" },
    });

    const empty = await runBoard(url, "check", "T-1", "gives up", "--rename");
    expect(empty.code).toBe(1);
    expect(empty.output).toContain("Give the new words");
  });

  it("check-edit answers with the current words when a person changed the item meanwhile", async () => {
    const { url, items, seen } = await fakeBoard();
    await add(url, "Retries work");
    // The person's edit lands between the agent's read and its write.
    const realPush = seen.push.bind(seen);
    seen.push = (...rows) => {
      if (rows[0].method === "PATCH") items[0].text = "Retries stop after five tries";
      return realPush(...rows);
    };

    const refused = await runBoard(url, "check-edit", "T-1", "1", "A failed send retries");
    expect(refused.code).toBe(9);
    expect(refused.output).toContain("nothing was written");
    expect(refused.output).toContain("Retries stop after five tries");
    expect(items[0].text).toBe("Retries stop after five tries");

    seen.push = realPush;
    const edited = await runBoard(url, "check-edit", "T-1", "1", "A failed send retries");
    expect(edited.code, edited.output).toBe(0);
    expect(items[0].text).toBe("A failed send retries");
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
