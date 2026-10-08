import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

/**
 * `@/db` for a route test: Postgres compiled to WebAssembly, in this process,
 * with every migration in `drizzle/` applied. The rows are faked in the sense
 * that they live in memory and die with the file; the SQL that reads them is
 * the server's own, so a route answers here as it does on the board.
 *
 * A test file says `vi.mock("@/db", () => import("@/test/db"))`.
 */
const client = new PGlite();
const real = drizzle(client, { schema });
await migrate(real, { migrationsFolder: "./drizzle" });

/*
 * PGlite is one connection. A route that reads through `db` while it holds a
 * transaction takes a second connection from the pool on the server, and here
 * would wait for its own transaction for ever. So a query made inside a
 * transaction's callback runs in that transaction. It then sees the rows the
 * transaction wrote, which the server's second connection would not; no
 * route reads a row it has just written in order to miss it.
 */
const open = new AsyncLocalStorage<typeof real>();

export const db = new Proxy(real, {
  get(target, key) {
    const here = open.getStore() ?? target;
    if (key === "transaction") {
      return (run: (tx: typeof real) => Promise<unknown>, config?: unknown) =>
        here.transaction(
          (tx) => open.run(tx as unknown as typeof real, () => run(tx as unknown as typeof real)),
          config as never,
        );
    }
    const value = Reflect.get(here, key);
    return typeof value === "function" ? value.bind(here) : value;
  },
});

/** Nothing here opens a socket, so nothing has a pool to end. */
export const pool = {
  query: (sql: string, params?: unknown[]) => client.query(sql, params),
  end: async () => undefined,
};
export { schema };
