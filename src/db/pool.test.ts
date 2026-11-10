import { afterEach, describe, expect, it, vi } from "vitest";
import { isDatabaseTimeout, TIMEOUTS, timeoutSettings } from "./timeouts";

vi.mock("server-only", () => ({}));

/*
 * The production build compiles a module once for the route chunks and once
 * for the page chunks. A fresh module registry is the same thing in a test:
 * whatever the module keeps for itself, it keeps twice.
 */
describe("One of each per process", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps one pool however often the module is loaded", async () => {
    vi.resetModules();
    const first = await import("./index");
    vi.resetModules();
    const second = await import("./index");
    expect(second.pool).toBe(first.pool);
  });

  it("keeps one rate limiter however often the module is loaded", async () => {
    vi.resetModules();
    const first = await import("@/lib/rate-limit");
    vi.resetModules();
    const second = await import("@/lib/rate-limit");
    expect(second.limiter).toBe(first.limiter);
  });

  it("waits at most ten seconds for a connection, and hears a dead one", async () => {
    const { pool } = await import("./index");
    expect(pool.options.connectionTimeoutMillis).toBe(10_000);
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    expect(pool.listenerCount("connect")).toBeGreaterThan(0);
  });

  it("sets the limits again at the start of every transaction", async () => {
    const { db, pool } = await import("./index");
    const said: string[] = [];
    const client = {
      query: async (q: string | { text: string }) => {
        said.push(typeof q === "string" ? q : q.text);
        return { rows: [], rowCount: 0, command: "", fields: [] };
      },
      release: () => {},
    };
    vi.spyOn(pool, "connect").mockImplementation((async () => client) as never);
    await db.transaction(async () => {});
    expect(said[0]).toBe("begin");
    expect(said[1]).toBe(timeoutSettings(true));
    expect(said.at(-1)).toBe("commit");
  });
});

describe("The limits", () => {
  it("cover a statement, a lock and a silent transaction, for the session or one transaction", () => {
    expect(timeoutSettings(false)).toContain(
      `'statement_timeout', '${TIMEOUTS.statementMs}', false`,
    );
    expect(timeoutSettings(true)).toContain(`'lock_timeout', '${TIMEOUTS.lockMs}', true`);
    expect(timeoutSettings(true)).toContain(
      `'idle_in_transaction_session_timeout', '${TIMEOUTS.idleInTransactionMs}', true`,
    );
  });

  it("are told apart from every other failure, also when wrapped", () => {
    const pg = (code: string) => Object.assign(new Error("pg"), { code });
    expect(isDatabaseTimeout(pg("57014"))).toBe(true);
    expect(isDatabaseTimeout(pg("55P03"))).toBe(true);
    expect(isDatabaseTimeout(pg("25P03"))).toBe(true);
    expect(isDatabaseTimeout(new Error("Failed query", { cause: pg("55P03") }))).toBe(true);
    expect(isDatabaseTimeout(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isDatabaseTimeout(pg("23505"))).toBe(false);
    expect(isDatabaseTimeout(new Error("Something else"))).toBe(false);
    expect(isDatabaseTimeout(null)).toBe(false);
  });
});
