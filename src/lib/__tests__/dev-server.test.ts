import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";

// A crash of next dev used to stop the app container, and the new container
// left rustfs on the old network. scripts/dev-server.mjs starts it again in
// the same container instead.

const script = fileURLToPath(new URL("../../../scripts/dev-server.mjs", import.meta.url));

// A stand-in for next dev: it writes a line for each start, then waits.
function supervise() {
  const dir = mkdtempSync(path.join(tmpdir(), "dev-server-"));
  const log = path.join(dir, "starts");
  const server = `require("fs").appendFileSync(${JSON.stringify(log)}, process.pid + "\\n"); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, [script, process.execPath, "-e", server], {
    env: { ...process.env, DEV_SERVER_PAUSE_MS: "50" },
    stdio: "ignore",
  });
  onTestFinished(() => {
    child.kill("SIGKILL");
  });
  const starts = () => {
    try {
      return readFileSync(log, "utf8").trim().split("\n").map(Number);
    } catch {
      return [];
    }
  };
  return { child, starts };
}

describe("dev-server.mjs", () => {
  it("starts the dev server again when it is killed, and stays up itself", async () => {
    const { child, starts } = supervise();
    await expect.poll(() => starts().length, { timeout: 5000 }).toBe(1);
    process.kill(starts()[0], "SIGKILL");
    await expect.poll(() => starts().length, { timeout: 5000 }).toBe(2);
    expect(child.exitCode).toBeNull();
    process.kill(starts()[1], "SIGKILL");
  });

  it("stops the dev server and itself on SIGTERM", async () => {
    const { child, starts } = supervise();
    await expect.poll(() => starts().length, { timeout: 5000 }).toBe(1);
    const exited = new Promise((resolve) => child.on("exit", resolve));
    child.kill("SIGTERM");
    await exited;
    expect(() => process.kill(starts()[0], 0)).toThrow();
    expect(starts()).toHaveLength(1);
  });

  it("runs the dev server in the Docker dev compose file", () => {
    const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");
    expect(compose).toMatch(/exec node scripts\/dev-server\.mjs npm run dev/);
    expect(compose).toMatch(/init: true/);
  });
});
