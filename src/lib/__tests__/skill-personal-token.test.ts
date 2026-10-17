import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** `board.mjs` with a personal token reaches every project of its person. */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

const PROJECTS = [
  { id: "p-ush", name: "Ushabti", key: "USH" },
  { id: "p-set", name: "Setmaat", key: "SET" },
];

const boardOf = (project: { id: string; name: string; key: string }) => ({
  project,
  properties: [],
  members: [{ name: "Ada" }],
  views: [],
  tasks: [{ id: `t-${project.key}`, key: `${project.key}-4`, title: "Fix it", values: {} }],
  archived: [],
  runs: [],
});

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

type Call = { method: string; url: string };

async function run(token: string, args: string[], env: Record<string, string> = {}) {
  const calls: Call[] = [];
  const projects = token === "ushp_one" ? PROJECTS.slice(0, 1) : PROJECTS;
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      calls.push({ method: req.method!, url: req.url! });
      const url = req.url!;
      const project = PROJECTS.find((p) => url.startsWith(`/api/projects/${p.id}/`));
      let status = 200;
      let body: unknown = {};
      if (url === "/api/agent/me") {
        if (token.startsWith("ushp_")) status = 403;
        else body = { agent: { id: "a1", name: "Scribe" }, project: PROJECTS[0] };
      } else if (url === "/api/auth/me") {
        if (token.startsWith("ushp_")) body = { user: { id: "u1", name: "Ada" }, via: "token" };
        else status = 403;
      } else if (url === "/api/projects") {
        body = { projects };
      } else if (project && url.endsWith("/board")) {
        body = boardOf(project);
      } else if (url.endsWith("/tasks")) {
        body = { task: { key: `${project!.key}-5` } };
      }
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status === 200 ? body : { error: "Forbidden" }));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return new Promise<{ code: number | null; out: string; err: string; calls: Call[] }>((done) => {
    const child = spawn(process.execPath, [BOARD_MJS, ...args], {
      env: {
        ...process.env,
        USHABTI_PROJECT: "",
        USHABTI_RUN: "",
        ...env,
        USHABTI_URL: `http://127.0.0.1:${port}`,
        USHABTI_TOKEN: token,
      },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => done({ code, out, err, calls }));
  });
}

const RUN_LINE = "A run needs an agent token. Make one in Settings → People.\n";

describe("board.mjs with a personal token", () => {
  it("works on the project a task key's prefix names", async () => {
    const { code, out, calls } = await run("ushp_x", ["comment", "SET-4", "looks right"]);
    expect(code).toBe(0);
    expect(out).toContain("SET-4: comment left");
    expect(calls.map((c) => c.url)).toEqual([
      "/api/auth/me",
      "/api/projects",
      "/api/projects/p-set/board",
      "/api/tasks/t-SET/comments",
    ]);
  });

  it("refuses a prefix of a project it does not reach", async () => {
    const { code, err } = await run("ushp_x", ["task", "NOPE-1"]);
    expect(code).not.toBe(0);
    expect(err).toContain("No project NOPE of yours. You are in: USH, SET");
  });

  it.each([["list"], ["new", "A task"], ["props"]])(
    "%s prints the keys and fails when several projects are not named",
    async (...args) => {
      const { code, err, calls } = await run("ushp_x", args);
      expect(code).not.toBe(0);
      expect(err).toContain("You are in: USH, SET");
      expect(calls.some((c) => c.url.endsWith("/board"))).toBe(false);
    },
  );

  it("takes --project, then USHABTI_PROJECT, then the only project", async () => {
    const flag = await run("ushp_x", ["new", "A task", "--project", "set"]);
    expect(flag.code).toBe(0);
    expect(flag.out).toContain("SET-5 created");
    expect(flag.calls.at(-1)).toEqual({ method: "POST", url: "/api/projects/p-set/tasks" });

    const env = await run("ushp_x", ["props"], { USHABTI_PROJECT: "SET" });
    expect(env.code).toBe(0);
    expect(env.calls.map((c) => c.url)).toContain("/api/projects/p-set/board");

    const only = await run("ushp_one", ["list"]);
    expect(only.code).toBe(0);
    expect(only.out).toContain("USH-4");
  });

  it.each([
    ["claim", "USH-4", "--goal", "x"],
    ["step", "USH-4", "--say", "x"],
    ["beat", "USH-4"],
    ["pause", "USH-4"],
    ["ask", "USH-4", "Which?"],
    ["finish", "USH-4"],
    ["watch", "--run", "true"],
  ])("%s exits with one line naming an agent token", async (...args) => {
    const { code, out, err, calls } = await run("ushp_x", args);
    expect(code).not.toBe(0);
    expect(out).toBe("");
    expect(err).toBe(RUN_LINE);
    expect(calls).toEqual([]);
  });

  it("refuses a tick inside a run, and ticks outside one", async () => {
    const inside = await run("ushp_x", ["check", "USH-4", "the item", "--done"], {
      USHABTI_RUN: "r1",
    });
    expect(inside.code).not.toBe(0);
    expect(inside.err).toBe(RUN_LINE);

    const outside = await run("ushp_x", ["check", "USH-4", "the item", "--done"]);
    expect(outside.err).not.toContain("agent token");
    expect(outside.calls.map((c) => c.url)).toContain("/api/projects/p-ush/board");
  });
});

describe("board.mjs with an agent token", () => {
  it("reads its one project from /api/agent/me, as before", async () => {
    const { code, out, calls } = await run("ush_x", ["comment", "USH-4", "done"]);
    expect(code).toBe(0);
    expect(out).toContain("USH-4: comment left");
    expect(calls.map((c) => c.url)).toEqual([
      "/api/agent/me",
      "/api/projects/p-ush/board",
      "/api/tasks/t-USH/comments",
    ]);
  });

  it("is not refused a run command", async () => {
    const { err, calls } = await run("ush_x", ["claim", "USH-4", "--goal", "x"]);
    expect(err).not.toContain("agent token");
    expect(calls.map((c) => c.url)).toContain("/api/tasks/t-USH/run");
  });
});
