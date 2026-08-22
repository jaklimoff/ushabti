import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://ushabti:ushabti@localhost:5435/ushabti";

/**
 * How many connections this process may hold. Twelve suits a database that
 * belongs to Ushabti alone. A managed cluster shared with other applications
 * usually allows far fewer in total — DigitalOcean's smallest allows 25 for
 * everything on it — so set DATABASE_POOL_MAX there and leave room for the
 * others. Live updates open one more connection on top of this, for LISTEN.
 */
const maxConnections = Math.max(1, Number(process.env.DATABASE_POOL_MAX) || 12);

// Next.js reloads modules during development. Keep one pool on globalThis so
// the process does not run out of Postgres connections.
const globalForDb = globalThis as unknown as { __ushabtiPool?: Pool };

export const pool =
  globalForDb.__ushabtiPool ??
  new Pool({ connectionString, max: maxConnections, idleTimeoutMillis: 30_000 });

if (process.env.NODE_ENV !== "production") globalForDb.__ushabtiPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
