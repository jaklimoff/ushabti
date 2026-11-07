import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

function base(): string {
  const url = test.info().project.use.baseURL;
  if (!url) throw new Error("The tests need a baseURL.");
  return url.replace(/\/$/, "");
}

type Raw = { headers: http.IncomingHttpHeaders; bytes: Buffer };

/* Node's own http, because fetch and Playwright both undo the encoding and
   hide the bytes that crossed the wire. */
function raw(url: string, headers: Record<string, string>): Promise<Raw> {
  return new Promise((done, failed) => {
    http
      .get(url, { headers }, (res) => {
        const parts: Buffer[] = [];
        res.on("data", (part: Buffer) => parts.push(part));
        res.on("end", () => done({ headers: res.headers, bytes: Buffer.concat(parts) }));
        res.on("error", failed);
      })
      .on("error", failed);
  });
}

function decoded({ headers, bytes }: Raw): string {
  const encoding = headers["content-encoding"];
  if (encoding === "gzip") return gunzipSync(bytes).toString("utf8");
  if (encoding === "br") return brotliDecompressSync(bytes).toString("utf8");
  return bytes.toString("utf8");
}

async function cookieOf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** A board with some weight to it, as a working project has. */
async function fill(page: Page, projectId: string) {
  const description = "A line of the kind a task carries, said once more. ".repeat(40);
  for (let i = 0; i < 12; i++) {
    const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title: `Task number ${i}`, description },
    });
    expect(made.ok()).toBeTruthy();
  }
}

test.describe("Compressed answers", () => {
  /* The route answers plain, and the server in front packs it: Next 16.4.5
     strips a route's own Content-Encoding (vercel/next.js#101192), and
     `next start` packs a route's answer from vercel/next.js#101220 on. So the
     wire may carry either, and what counts is that every caller reads it. */
  test("the board read reads the same, whatever the caller accepts", async ({ page }) => {
    await register(page, "Squeeze Owner");
    const projectId = await createProject(page, unique("Squeeze"));
    await fill(page, projectId);
    const cookie = await cookieOf(page);
    const url = `${base()}/api/projects/${projectId}/board`;

    const plain = await raw(url, { Cookie: cookie });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    const board = JSON.parse(plain.bytes.toString("utf8"));
    expect(board.tasks).toHaveLength(12);

    for (const accept of ["gzip", "br", "gzip, deflate, br"]) {
      const packed = await raw(url, { Cookie: cookie, "Accept-Encoding": accept });
      const encoding = packed.headers["content-encoding"];
      // Packed bytes under no Content-Encoding are what broke the board.
      expect([undefined, "gzip", "br"]).toContain(encoding);
      expect(JSON.parse(decoded(packed))).toEqual(board);
      expect(!encoding || /accept-encoding/i.test(packed.headers.vary ?? "")).toBe(true);
      console.log(
        `board read, Accept-Encoding ${accept}: ${plain.bytes.length} bytes plain, ` +
          `${packed.bytes.length} on the wire as ${encoding ?? "plain"}`,
      );
    }
  });

  test("an event on the stream still arrives at once", async ({ page }) => {
    await register(page, "Stream Owner");
    const projectId = await createProject(page, unique("Stream"));
    const cookie = await cookieOf(page);

    const req = http.get(`${base()}/api/projects/${projectId}/stream`, {
      headers: { Cookie: cookie, "Accept-Encoding": "gzip, br" },
    });
    try {
      const res = await new Promise<http.IncomingMessage>((done) => req.on("response", done));
      expect(res.headers["content-encoding"]).toBeUndefined();
      let text = "";
      const heard = (word: string) =>
        new Promise<void>((done) => {
          const look = () => text.includes(word) && done();
          res.on("data", (part: Buffer) => {
            text += part.toString("utf8");
            look();
          });
          look();
        });
      await expect(heard("event: ready")).resolves.toBeUndefined();

      const sent = Date.now();
      const changed = heard("event: change");
      const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
        data: { title: "Ring the bell" },
      });
      expect(made.ok()).toBeTruthy();
      await changed;
      // Well under the heartbeat: a buffered event would wait for the next ping.
      expect(Date.now() - sent).toBeLessThan(3000);
    } finally {
      req.destroy();
    }
  });

  test("board.mjs reads the compressed answers", async ({ page }) => {
    await register(page, "Agent Owner");
    const projectId = await createProject(page, unique("Reader"));
    await fill(page, projectId);
    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Reader");
    await page.getByRole("button", { name: "Add agent" }).click();
    const box = page.getByTestId("agent-box").filter({ hasText: "Reader" });
    await box.getByRole("button", { name: "Connect" }).click();
    await box.getByRole("button", { name: "Make token" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
    ).trim();

    const out = await new Promise<string>((done, failed) => {
      const child = spawn(process.execPath, [BOARD_MJS, "list"], {
        env: { ...process.env, USHABTI_URL: base(), USHABTI_TOKEN: token },
      });
      let text = "";
      child.stdout.on("data", (part) => (text += part));
      child.stderr.on("data", (part) => (text += part));
      child.on("exit", (code) => (code === 0 ? done(text) : failed(new Error(text))));
    });
    expect(out).toContain("Task number 11");
  });
});
