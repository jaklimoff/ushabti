import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { databaseUrl, poolMax } from "./url";
import { TIMEOUTS, timeoutSettings } from "./timeouts";

const connectionString = databaseUrl();
const maxConnections = poolMax();

/* One pool per process, in every environment. The production build compiles
   this file into the route chunks and again into the page chunks, so a pool
   kept only in the module was two pools of DATABASE_POOL_MAX. Next's reloads
   in development made the same mistake one at a time. */
const globalForDb = globalThis as unknown as { __ushabtiPool?: Pool };

function makePool(): Pool {
  const made = new Pool({
    connectionString,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: TIMEOUTS.connectMs,
  });
  /* A connection that dies while idle in the pool is reported here. Unheard,
     it is an uncaught error and takes the whole process down. */
  made.on("error", (err) => console.error("[ushabti] idle database connection failed", err));
  /* The limits for the session. They are sent as a statement and not as
     startup options, because PgBouncer refuses a startup option it does not
     know. Behind a pooler in transaction mode a session setting may land on
     another server connection, so every transaction sets them again below. */
  made.on("connect", (client) => {
    client.query(timeoutSettings(false)).catch(() => {});
  });
  return made;
}

export const pool = globalForDb.__ushabtiPool ?? (globalForDb.__ushabtiPool = makePool());

const base = drizzle(pool, { schema });

const local = sql.raw(timeoutSettings(true));
const transaction = base.transaction.bind(base);
/* Every transaction carries its own limits, which hold on whichever server
   connection a pooler gives it. One statement, so it costs one round trip. */
base.transaction = ((work, config) =>
  transaction(async (tx) => {
    await tx.execute(local);
    return work(tx);
  }, config)) as typeof base.transaction;

export const db = base;
export { schema };
