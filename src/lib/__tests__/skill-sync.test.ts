import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The Mnemes names, `describe --replace` and `update`: what one board.mjs
 * needs to run in every project, and to bring itself up to date.
 */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

type Item = { id: string; text: string; done: boolean };
type Seen = { method: string; url: string; body: Record<string, unknown> | undefined }[];

let server: Server | null = null;
const dirs: string[] = [];

afterEach(() => {
  server?.close();
  server = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Board = {
  url: string;
  seen: Seen;
  items: Item[];
  task: {
    title: string;
    description: string;
    describedBy: string | null;
    meanwhile: string | null;
  };
  skill: Record<string, { status: number; body: string }>;
};

/** A board with one task, T-1, whose description a person wrote. */
async function fakeBoard(): Promise<Board> {
  const seen: Seen = [];
  const items: Item[] = [];
  // `meanwhile` is a person's edit that lands while the agent posts a comment.
  const task: Board["task"] = {
    title: "Ship",
    description: "A person's words",
    describedBy: "u-person",
    meanwhile: null,
  };
  const skill: Board["skill"] = {};
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const url = req.url ?? "";
      seen.push({ method: req.method ?? "", url, body });
      const send = (status: number, answer: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(answer));
      };
      if (url.startsWith("/skill/")) {
        const file = skill[url.slice("/skill/".length)] ?? { status: 404, body: "Not found." };
        res.writeHead(file.status, { "Content-Type": "text/plain" });
        res.end(file.body);
        return;
      }
      if (url === "/api/agent/me")
        return send(200, { agent: { id: "u-agent", name: "Ticker" }, project: { id: "p1" } });
      if (url === "/api/projects/p1/board")
        return send(200, {
          project: { id: "p1", name: "Demo", key: "T" },
          properties: [],
          tasks: [{ id: "t1", key: "T-1" }],
          runs: [],
          archived: [],
        });
      if (url === "/api/tasks/t1" && req.method === "GET") {
        const activity = task.describedBy
          ? [{ kind: "description", actor: { id: task.describedBy } }]
          : [];
        return send(200, {
          task: { ...task, values: {}, comments: [], checklist: items, activity },
        });
      }
      if (url === "/api/tasks/t1" && req.method === "PATCH") {
        if (body.baseDescription !== undefined && body.baseDescription !== task.description)
          return send(409, { error: "This changed while you typed.", current: task.description });
        if (body.title !== undefined) task.title = body.title;
        if (body.description !== undefined) {
          task.description = body.description;
          task.describedBy = "u-agent";
        }
        return send(200, {});
      }
      if (req.method === "POST" && url === "/api/tasks/t1/comments" && task.meanwhile)
        task.description = task.meanwhile;
      if (req.method === "POST" && url === "/api/tasks/t1/checklist")
        items.push({ id: `i${items.length + 1}`, text: body.text, done: false });
      if (req.method === "PATCH" && url.startsWith("/api/checklist/")) {
        const item = items.find((i) => url.endsWith(`/${i.id}`));
        if (item && body.done !== undefined) item.done = body.done;
      }
      send(200, {});
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, items, task, skill };
}

function runBoard(url: string, args: string[], script = BOARD_MJS) {
  return new Promise<{ code: number | null; output: string }>((done) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, USHABTI_URL: url, USHABTI_TOKEN: "ush_test" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => done({ code, output }));
  });
}

const writes = (b: Board) => b.seen.filter((s) => s.method !== "GET");

describe("The Mnemes names", () => {
  it("rename writes the title, as retitle does", async () => {
    const b = await fakeBoard();
    const out = await runBoard(b.url, ["rename", "T-1", "Retries stop after five tries"]);
    expect(out.code, out.output).toBe(0);
    expect(b.task.title).toBe("Retries stop after five tries");
  });

  it("check-add adds an item, and check-set ticks and unticks one by its number", async () => {
    const b = await fakeBoard();
    for (const text of ["First", "Second"]) {
      const out = await runBoard(b.url, ["check-add", "T-1", text]);
      expect(out.code, out.output).toBe(0);
    }
    expect(b.items.map((i) => i.text)).toEqual(["First", "Second"]);

    const ticked = await runBoard(b.url, ["check-set", "T-1", "2", "--done", "true"]);
    expect(ticked.code, ticked.output).toBe(0);
    expect(b.items.map((i) => i.done)).toEqual([false, true]);

    const unticked = await runBoard(b.url, ["check-set", "T-1", "2", "--done", "false"]);
    expect(unticked.code, unticked.output).toBe(0);
    expect(b.items.map((i) => i.done)).toEqual([false, false]);
  });

  it("check-set refuses without a true or false, and check-add without words", async () => {
    const b = await fakeBoard();
    await runBoard(b.url, ["check-add", "T-1", "First"]);
    const vague = await runBoard(b.url, ["check-set", "T-1", "1", "--done", "maybe"]);
    expect(vague.code).toBe(1);
    expect(vague.output).toContain("--done true");
    const empty = await runBoard(b.url, ["check-add", "T-1", " "]);
    expect(empty.code).toBe(1);
    expect(b.items).toHaveLength(1);
    expect(b.items[0].done).toBe(false);
  });
});

describe("describe", () => {
  it("still refuses a person's description without --replace", async () => {
    const b = await fakeBoard();
    const out = await runBoard(b.url, ["describe", "T-1", "My rewrite"]);
    expect(out.code).toBe(1);
    expect(out.output).toContain("a person wrote");
    expect(b.task.description).toBe("A person's words");
    expect(writes(b)).toEqual([]);
  });

  it("--replace posts the old description as a comment, then writes the new one", async () => {
    const b = await fakeBoard();
    const out = await runBoard(b.url, ["describe", "T-1", "--replace", "My rewrite"]);
    expect(out.code, out.output).toBe(0);
    expect(b.task.description).toBe("My rewrite");
    const [comment, patch] = writes(b);
    expect(comment.url).toBe("/api/tasks/t1/comments");
    expect(comment.body?.body).toContain("replaced");
    expect(comment.body?.body).toContain("A person's words");
    expect(patch).toMatchObject({
      method: "PATCH",
      body: { description: "My rewrite", baseDescription: "A person's words" },
    });
  });

  it("--replace writes nothing over an edit a person made meanwhile", async () => {
    const b = await fakeBoard();
    b.task.meanwhile = "Edited meanwhile";
    const out = await runBoard(b.url, ["describe", "T-1", "--replace", "My rewrite"]);
    expect(out.code).toBe(9);
    expect(out.output).toContain("changed meanwhile");
    expect(b.task.description).toBe("Edited meanwhile");
  });
});

describe("board.mjs update", () => {
  /** A copy of board.mjs in a folder of its own, beside an old SKILL.md. */
  function copy() {
    const dir = mkdtempSync(path.join(tmpdir(), "ushabti-skill-"));
    dirs.push(dir);
    const script = path.join(dir, "board.mjs");
    copyFileSync(BOARD_MJS, script);
    writeFileSync(path.join(dir, "SKILL.md"), "old skill");
    return { dir, script };
  }

  it("writes board.mjs and SKILL.md from the board, and names both versions", async () => {
    const b = await fakeBoard();
    const { dir, script } = copy();
    const fresh = `${readFileSync(BOARD_MJS, "utf8")}\n// newer\n`;
    b.skill["board.mjs"] = { status: 200, body: fresh };
    b.skill["SKILL.md"] = { status: 200, body: "new skill" };

    const out = await runBoard(b.url, ["update"], script);
    expect(out.code, out.output).toBe(0);
    expect(out.output).toMatch(/board\.mjs [0-9a-f]{12} -> [0-9a-f]{12}/);
    expect(readFileSync(script, "utf8")).toBe(fresh);
    expect(readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe("new skill");
  });

  it("changes nothing when a download fails", async () => {
    const b = await fakeBoard();
    const { dir, script } = copy();
    b.skill["board.mjs"] = { status: 200, body: `${readFileSync(BOARD_MJS, "utf8")}\n// newer\n` };
    b.skill["SKILL.md"] = { status: 500, body: "down" };

    const out = await runBoard(b.url, ["update"], script);
    expect(out.code).toBe(1);
    expect(out.output).toContain("Nothing changed");
    expect(readFileSync(script, "utf8")).toBe(readFileSync(BOARD_MJS, "utf8"));
    expect(readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe("old skill");
  });

  it("changes nothing when the board serves something that is not board.mjs", async () => {
    const b = await fakeBoard();
    const { dir, script } = copy();
    b.skill["board.mjs"] = { status: 200, body: "<html>sign in</html>" };
    b.skill["SKILL.md"] = { status: 200, body: "new skill" };

    const out = await runBoard(b.url, ["update"], script);
    expect(out.code).toBe(1);
    expect(readFileSync(script, "utf8")).toBe(readFileSync(BOARD_MJS, "utf8"));
    expect(readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe("old skill");
  });
});

describe("help", () => {
  it("lists the new commands and when --replace may be used", async () => {
    const out = await runBoard("http://127.0.0.1:1", ["help"]);
    for (const word of [
      "rename <key>",
      "check-add <key>",
      "check-set <key>",
      "--replace",
      "update",
    ])
      expect(out.output).toContain(word);
    expect(out.output).toContain("a person said yes to");
    const skill = readFileSync(path.resolve(BOARD_MJS, "../SKILL.md"), "utf8");
    for (const word of ["rename", "check-add", "check-set", "--replace", "board.mjs update"])
      expect(skill).toContain(word);
    expect(skill).toContain("said yes to your rewrite");
  });
});
