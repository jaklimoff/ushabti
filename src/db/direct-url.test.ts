import { execFile } from "node:child_process";
import { createServer, type AddressInfo, type Server } from "node:net";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { databaseUrl, directDatabaseUrl } from "./url";

const POOLED = "postgres://u:p@pooler:25061/ushabti";
const DIRECT = "postgres://u:p@primary:25060/ushabti";

describe("directDatabaseUrl", () => {
  it("names the direct connection when it is set", () => {
    const env = { DATABASE_URL: POOLED, DATABASE_DIRECT_URL: DIRECT };
    expect(directDatabaseUrl(env)).toBe(DIRECT);
    expect(databaseUrl(env)).toBe(POOLED);
  });

  it("reads an empty value as unset", () => {
    expect(directDatabaseUrl({ DATABASE_URL: POOLED, DATABASE_DIRECT_URL: "" })).toBe(POOLED);
    expect(directDatabaseUrl({ DATABASE_URL: POOLED })).toBe(POOLED);
  });

  it("falls back to the dev database outside production", () => {
    const dev = databaseUrl({ NODE_ENV: "test" });
    expect(directDatabaseUrl({ NODE_ENV: "test", DATABASE_DIRECT_URL: "" })).toBe(dev);
  });

  it("still refuses a production start with no URL", () => {
    expect(() => directDatabaseUrl({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
  });
});

/** A port that only counts who knocks, so a script shows where it went. */
async function door(): Promise<{ port: number; knocks: () => number; server: Server }> {
  let count = 0;
  const server = createServer((socket) => {
    count += 1;
    socket.destroy();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { port: (server.address() as AddressInfo).port, knocks: () => count, server };
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const run = promisify(execFile);

describe.each(["scripts/migrate.mjs", "scripts/baseline.mjs"])("%s", (script) => {
  async function connectsTo(direct: "set" | "empty") {
    const pooled = await door();
    const straight = await door();
    servers.push(pooled.server, straight.server);
    const env = {
      ...process.env,
      DATABASE_URL: `postgres://u:p@127.0.0.1:${pooled.port}/ushabti`,
      DATABASE_DIRECT_URL:
        direct === "set" ? `postgres://u:p@127.0.0.1:${straight.port}/ushabti` : "",
    };
    // The door hangs up, so the script fails; only where it knocked matters.
    await run("node", [script], { env }).catch(() => undefined);
    return { pooled: pooled.knocks(), direct: straight.knocks() };
  }

  it("connects to DATABASE_DIRECT_URL when it is set", async () => {
    const seen = await connectsTo("set");
    expect(seen.direct).toBeGreaterThan(0);
    expect(seen.pooled).toBe(0);
  });

  it("connects to DATABASE_URL when DATABASE_DIRECT_URL is empty", async () => {
    const seen = await connectsTo("empty");
    expect(seen.pooled).toBeGreaterThan(0);
    expect(seen.direct).toBe(0);
  });
});
