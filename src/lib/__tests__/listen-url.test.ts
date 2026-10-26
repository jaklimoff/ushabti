import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const made = vi.hoisted(() => ({ clients: [] as string[], pools: [] as string[] }));

vi.mock("pg", () => {
  class Client {
    constructor(config: { connectionString: string }) {
      made.clients.push(config.connectionString);
    }
    on() {}
    async connect() {}
    async query() {}
  }
  class Pool {
    constructor(config: { connectionString: string }) {
      made.pools.push(config.connectionString);
    }
    on() {}
  }
  return { Client, Pool, default: { Client, Pool } };
});

const POOLED = "postgres://u:p@pooler:25061/ushabti";
const DIRECT = "postgres://u:p@primary:25060/ushabti";

/** The pool and the hub live on globalThis, so each case starts with neither. */
function forget() {
  const g = globalThis as Record<string, unknown>;
  delete g.__ushabtiPool;
  delete g.__ushabtiHub;
}

describe("the LISTEN client of live updates", () => {
  beforeEach(() => {
    vi.resetModules();
    forget();
    made.clients.length = 0;
    made.pools.length = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    forget();
  });

  it("connects to DATABASE_DIRECT_URL while the pool keeps DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", POOLED);
    vi.stubEnv("DATABASE_DIRECT_URL", DIRECT);
    const { subscribe } = await import("../events");
    await subscribe("p1", () => {});
    expect(made.clients).toEqual([DIRECT]);
    expect(made.pools).toEqual([POOLED]);
  });

  it("connects to DATABASE_URL when DATABASE_DIRECT_URL is empty", async () => {
    vi.stubEnv("DATABASE_URL", POOLED);
    vi.stubEnv("DATABASE_DIRECT_URL", "");
    const { subscribe } = await import("../events");
    await subscribe("p1", () => {});
    expect(made.clients).toEqual([POOLED]);
    expect(made.pools).toEqual([POOLED]);
  });
});
