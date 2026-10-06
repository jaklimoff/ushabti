import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { routeFiles, sameFiles } from "../../../scripts/dev-route-watch.mjs";

// Docker Desktop does not pass the event for a new file into the container, so
// the dev server there kept a route folder added while it ran a 404 until a
// restart. scripts/dev-route-watch.mjs restarts it when a route file comes.

function app() {
  const dir = mkdtempSync(path.join(tmpdir(), "route-watch-"));
  mkdirSync(path.join(dir, "api", "tasks"), { recursive: true });
  writeFileSync(path.join(dir, "layout.tsx"), "");
  writeFileSync(path.join(dir, "api", "tasks", "route.ts"), "");
  writeFileSync(path.join(dir, "api", "tasks", "helpers.ts"), "");
  return dir;
}

describe("the dev server's route watcher", () => {
  it("sees a route folder added after it started", () => {
    const dir = app();
    const before = routeFiles(dir);
    mkdirSync(path.join(dir, "api", "probe"));
    expect(sameFiles(before, routeFiles(dir))).toBe(true);
    writeFileSync(path.join(dir, "api", "probe", "route.ts"), "");
    expect(sameFiles(before, routeFiles(dir))).toBe(false);
  });

  it("sees a folder that holds only a metadata route", () => {
    const dir = app();
    const before = routeFiles(dir);
    mkdirSync(path.join(dir, "blog"));
    writeFileSync(path.join(dir, "blog", "opengraph-image.tsx"), "");
    expect(sameFiles(before, routeFiles(dir))).toBe(false);
  });

  it("ignores a file that is not a route", () => {
    const dir = app();
    const before = routeFiles(dir);
    writeFileSync(path.join(dir, "api", "tasks", "more.ts"), "");
    expect(sameFiles(before, routeFiles(dir))).toBe(true);
    expect([...before].map((f) => path.relative(dir, f)).sort()).toEqual([
      path.join("api", "tasks", "route.ts"),
      "layout.tsx",
    ]);
  });

  it("touches next.config.mjs when a route folder is added while it runs", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "route-watch-run-"));
    mkdirSync(path.join(root, "src", "app"), { recursive: true });
    const config = path.join(root, "next.config.mjs");
    writeFileSync(config, "export default {};\n");
    const old = new Date(Date.now() - 60_000);
    utimesSync(config, old, old);
    const script = fileURLToPath(new URL("../../../scripts/dev-route-watch.mjs", import.meta.url));
    const child = spawn(process.execPath, [script], { cwd: root, stdio: "ignore" });
    onTestFinished(() => {
      child.kill();
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // Half a minute of margin: an mtime read back from disk is a float and may round.
    expect(statSync(config).mtimeMs).toBeLessThan(old.getTime() + 30_000);
    mkdirSync(path.join(root, "src", "app", "probe"));
    writeFileSync(path.join(root, "src", "app", "probe", "route.ts"), "");
    await expect
      .poll(() => statSync(config).mtimeMs, { timeout: 5000, interval: 100 })
      .toBeGreaterThan(old.getTime() + 30_000);
  });

  it("is started beside the dev server by the Docker dev compose file", () => {
    const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");
    expect(compose).toMatch(/node scripts\/dev-route-watch\.mjs & exec npm run dev/);
  });
});
