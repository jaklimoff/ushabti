import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** `board.mjs me` naming the acts an admin switched off, from `/api/agent/me`. */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

async function fakeBoard(off: { act: string; words: string }[]) {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body: unknown = { ok: true };
    if (req.url === "/api/agent/me") {
      body = { agent: { name: "Scribe" }, project: { id: "p1", name: "Demo", key: "T", off } };
    } else if (req.url === "/api/projects/p1/board") {
      body = { project: { id: "p1", name: "Demo", key: "T" }, properties: [], tasks: [], runs: [] };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function runBoard(url: string, ...args: string[]) {
  return new Promise<{ code: number | null; out: string }>((done) => {
    const child = spawn(process.execPath, [BOARD_MJS, ...args], {
      env: { ...process.env, USHABTI_URL: url, USHABTI_TOKEN: "ush_test" },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => done({ code, out }));
  });
}

describe("board.mjs me", () => {
  it("prints the acts switched off on its first line", async () => {
    const url = await fakeBoard([
      { act: "delete", words: "delete tasks" },
      { act: "ship", words: "ship releases" },
    ]);
    const { code, out } = await runBoard(url, "me");
    expect(code).toBe(0);
    expect(out.split("\n")[0]).toBe(
      `Scribe on Demo (T) at ${url}; may not delete tasks, ship releases`,
    );
  });

  it("says nothing more when every act is on", async () => {
    const url = await fakeBoard([]);
    const { out } = await runBoard(url, "me");
    expect(out.split("\n")[0]).toBe(`Scribe on Demo (T) at ${url}`);
  });
});
