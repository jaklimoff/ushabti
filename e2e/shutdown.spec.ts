import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { request as http, type IncomingMessage } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createProject, register } from "./helpers";

/*
 * A deploy sends SIGTERM. Next closes the server and waits for every request,
 * and a stream never ends, so each deploy waited out its grace period and was
 * killed. The server ends its streams and leaves within a few seconds.
 *
 * It starts a second copy of the very server the image runs, the standalone
 * build, on a port of its own and the same database, so stopping it stops
 * nobody else's test. Only the CI way has that build.
 */

const server = path.join(process.cwd(), ".next/standalone/server.js");

const freePort = () =>
  new Promise<number>((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

/** Opens a stream with the session cookie and waits for its `ready`. */
function openStream(port: number, at: string, cookie: string) {
  return new Promise<{ ended: Promise<void> }>((done, fail) => {
    const req = http({ host: "localhost", port, path: at, headers: { cookie } }, (res) => {
      if (res.statusCode !== 200) return fail(new Error(`${at} answered ${res.statusCode}`));
      const ended = new Promise<void>((end) => {
        res.on("end", end);
        res.on("close", end);
      });
      let heard = "";
      const listen = (chunk: Buffer) => {
        heard += chunk.toString();
        if (!heard.includes("event: ready")) return;
        (res as IncomingMessage).off("data", listen);
        res.resume();
        done({ ended });
      };
      res.on("data", listen);
    });
    req.on("error", fail);
    req.end();
  });
}

test("the server ends its open streams and leaves within a few seconds of SIGTERM", async ({
  page,
}, testInfo) => {
  // eslint-disable-next-line playwright/no-skipped-test -- next dev has no standalone build to stop
  test.skip(!process.env.CI || !existsSync(server), "needs the standalone build the image runs");
  testInfo.setTimeout(90_000);

  await register(page, "Stopper");
  const projectId = await createProject(page, "Stopped");
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  const port = await freePort();
  const child = spawn(process.execPath, [server], {
    cwd: path.dirname(server),
    env: { ...process.env, PORT: String(port), HOSTNAME: "localhost" },
    stdio: "ignore",
  });
  const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
  try {
    await expect
      .poll(
        () =>
          fetch(`http://localhost:${port}/api/health`)
            .then((r) => r.status)
            .catch(() => 0),
        { timeout: 30_000 },
      )
      .toBe(200);

    const streams = await Promise.all([
      openStream(port, "/api/home/stream", cookie),
      openStream(port, `/api/projects/${projectId}/stream`, cookie),
    ]);

    const sent = Date.now();
    child.kill("SIGTERM");
    await Promise.all(streams.map((s) => s.ended));
    const code = await exited;
    const took = Date.now() - sent;

    /* Under the five seconds after which the server leaves anyway: the streams
       ended, and nothing else held it open. */
    expect(took).toBeLessThan(4_000);
    expect(code).toBe(143);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
