import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * `sh` as PID 1 ignores SIGTERM, so a deploy waited out its grace period and
 * killed the server. The shell runs the migration and then becomes node.
 */
describe("the image", () => {
  it("runs node as PID 1, after the migration", () => {
    const file = readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    const cmd = file.split("\n").filter((line) => line.startsWith("CMD "));
    expect(cmd).toEqual(['CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]']);
  });
});
