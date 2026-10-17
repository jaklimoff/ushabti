import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** `board.mjs prop add` adding a property, against a board that records what was asked. */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

async function fakeBoard() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: unknown = { ok: true };
      let status = 200;
      if (req.url === "/api/agent/me") body = { agent: { name: "Scribe" }, project: { id: "p1" } };
      else if (req.url === "/api/projects/p1/board") {
        body = {
          project: { id: "p1", name: "Demo", key: "T" },
          properties: [{ id: "s", name: "Status", type: "select", options: [] }],
          members: [],
          tasks: [],
          runs: [],
        };
      } else {
        const sent = raw ? JSON.parse(raw) : null;
        calls.push({ method: req.method ?? "", url: req.url ?? "", body: sent });
        status = 201;
        body = {
          property: {
            id: "new",
            name: sent.name,
            type: sent.type,
            options: (sent.options ?? []).map((name: string) => ({ name })),
          },
        };
      }
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls };
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

describe("board.mjs prop add", () => {
  it("adds a select with its options", async () => {
    const { url, calls } = await fakeBoard();
    const result = await runBoard(
      url,
      "prop",
      "add",
      "Area",
      "select",
      "--option",
      "API",
      "--option",
      "Web",
    );
    expect(result.err).toBe("");
    expect(calls).toEqual([
      {
        method: "POST",
        url: "/api/projects/p1/properties",
        body: { name: "Area", type: "select", options: ["API", "Web"] },
      },
    ]);
    expect(result.out).toContain("Area (select) added: API | Web");
  });

  it("adds a property with no options", async () => {
    const { url, calls } = await fakeBoard();
    const result = await runBoard(url, "prop", "add", "Notes", "text");
    expect(result.err).toBe("");
    expect(calls).toEqual([
      { method: "POST", url: "/api/projects/p1/properties", body: { name: "Notes", type: "text" } },
    ]);
  });

  it("refuses a name the board already has, and sends nothing", async () => {
    const { url, calls } = await fakeBoard();
    const result = await runBoard(url, "prop", "add", "status", "select");
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("already has Status (select)");
    expect(calls).toEqual([]);
  });

  it("is listed in help", async () => {
    const result = await runBoard("http://127.0.0.1:1", "help");
    expect(result.out).toContain('prop add "<name>" <type> [--option "<name>"]...');
  });
});
