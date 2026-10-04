import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** `board.mjs attach` uploads to the signed URL, says ready, and prints the Markdown line. */
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");
const ID = "44444444-4444-4444-8444-444444444444";

const BOARD = {
  project: { id: "p1", name: "Demo", key: "T" },
  properties: [],
  members: [],
  tasks: [{ id: "t1", key: "T-1", title: "One", values: {} }],
  runs: [],
};

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

type Seen = { method: string; url: string; headers: Record<string, unknown>; body: string };

async function run(file: string, ...args: string[]) {
  const seen: Seen[] = [];
  let base = "";
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      let answer: unknown = {};
      if (req.url === "/api/agent/me")
        answer = { agent: { name: "Scribe" }, project: { id: "p1" } };
      if (req.url === "/api/projects/p1/board") answer = BOARD;
      if (req.url === "/api/tasks/t1/attachments") {
        answer = {
          id: ID,
          uploadUrl: `${base}/bucket/projects/p1/${ID}?X-Amz-Signature=x`,
          headers: { "Content-Type": JSON.parse(body).mime },
        };
      }
      if (req.url === `/api/attachments/${ID}/ready`) {
        answer = { attachment: { id: ID, name: "shot [1].png" } };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(req.method === "PUT" ? "" : JSON.stringify(answer));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  return new Promise<{ code: number | null; out: string; err: string; seen: Seen[] }>((done) => {
    const child = spawn(process.execPath, [BOARD_MJS, "attach", "T-1", file, ...args], {
      env: { ...process.env, USHABTI_URL: base, USHABTI_TOKEN: "ush_test" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => done({ code, out, err, seen }));
  });
}

function tempFile(name: string, content: string) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "attach-")), name);
  writeFileSync(file, content);
  return file;
}

describe("board.mjs attach", () => {
  it("asks for an upload, PUTs the bytes, says ready and prints the Markdown line", async () => {
    const { code, out, seen } = await run(tempFile("shot [1].png", "PNGBYTES"));
    expect(code).toBe(0);
    expect(out.trim()).toBe(`![shot 1.png](/api/attachments/${ID})`);

    const ask = seen.find((s) => s.url === "/api/tasks/t1/attachments")!;
    expect(ask.method).toBe("POST");
    expect(JSON.parse(ask.body)).toEqual({ name: "shot [1].png", mime: "image/png", size: 8 });

    const put = seen.find((s) => s.method === "PUT")!;
    expect(put.url).toBe(`/bucket/projects/p1/${ID}?X-Amz-Signature=x`);
    expect(put.body).toBe("PNGBYTES");
    expect(put.headers["content-type"]).toBe("image/png");
    expect(put.headers["content-length"]).toBe("8");
    // The bucket's URL is signed; the board's token never goes there.
    expect(put.headers.authorization).toBeUndefined();

    const order = seen.map((s) => `${s.method} ${s.url.split("?")[0]}`).slice(-3);
    expect(order).toEqual([
      "POST /api/tasks/t1/attachments",
      `PUT /bucket/projects/p1/${ID}`,
      `POST /api/attachments/${ID}/ready`,
    ]);
  });

  it("takes --mime for a name it cannot read, and refuses without one", async () => {
    const file = tempFile("notes.bin", "x");
    const without = await run(file);
    expect(without.code).not.toBe(0);
    expect(without.err).toContain("--mime");

    const named = await run(file, "--mime", "video/mp4");
    expect(named.code).toBe(0);
    const ask = named.seen.find((s) => s.url === "/api/tasks/t1/attachments")!;
    expect(JSON.parse(ask.body).mime).toBe("video/mp4");
  });
});
