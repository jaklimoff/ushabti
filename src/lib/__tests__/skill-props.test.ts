import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** `board.mjs props` says the dates and the note an option carries. */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

const plain = { startAt: null, targetAt: null, shippedAt: null, note: null };
const BOARD = {
  project: { id: "p1", name: "Demo", key: "T" },
  properties: [
    {
      name: "Sprint",
      type: "select",
      options: [
        {
          name: "Sprint 4",
          startAt: "2026-10-01",
          targetAt: "2026-10-14",
          shippedAt: "2026-10-13",
          note: "Ships the **API**.\nThen the docs.",
        },
        { name: "Sprint 5", ...plain, targetAt: "2026-10-28" },
        { name: "Later", ...plain },
      ],
    },
    { name: "Labels", type: "multi_select", options: [{ name: "bug", ...plain }] },
    {
      id: "p-type",
      name: "Type",
      type: "select",
      options: [
        { id: "o-bug", name: "Bug", ...plain },
        { id: "o-story", name: "Story", ...plain },
      ],
    },
    {
      id: "p-sev",
      name: "Severity",
      type: "text",
      config: { when: { propertyId: "p-type", optionIds: ["o-bug", "__none__"] } },
      options: [],
    },
  ],
  members: [{ name: "Ada" }],
  tasks: [],
  runs: [],
};

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function run(...args: string[]) {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const body =
        req.url === "/api/agent/me"
          ? { agent: { name: "Scribe" }, project: { id: "p1" } }
          : req.url === "/api/projects/p1/board"
            ? BOARD
            : {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return new Promise<{ code: number | null; out: string }>((done) => {
    const child = spawn(process.execPath, [BOARD_MJS, ...args], {
      env: { ...process.env, USHABTI_URL: `http://127.0.0.1:${port}`, USHABTI_TOKEN: "ush_test" },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => done({ code, out }));
  });
}

describe("board.mjs props", () => {
  it("says the start, the target, the shipped date and the note of an option", async () => {
    const { code, out } = await run("props");
    expect(code).toBe(0);
    expect(out).toContain("Sprint (select)");
    expect(out).toContain(
      "Sprint 4 · 2026-10-01 → 2026-10-14 · shipped 2026-10-13 · Ships the **API**.",
    );
    expect(out).toContain("Sprint 5 · → 2026-10-28");
    expect(out).toContain("Labels (multi_select): bug");
  });

  it("says when a property shows", async () => {
    const { code, out } = await run("props");
    expect(code).toBe(0);
    expect(out).toContain("Severity (text) · shown when Type is Bug or No type");
    expect(out).toContain("Type (select): Bug | Story\n");
  });
});
