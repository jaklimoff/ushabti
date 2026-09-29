import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { databaseUrl, poolMax } from "./url";

const connectionString = databaseUrl();
const maxConnections = poolMax();

// Next.js reloads modules during development. Keep one pool on globalThis so
// the process does not run out of Postgres connections.
const globalForDb = globalThis as unknown as { __ushabtiPool?: Pool };

export const pool =
  globalForDb.__ushabtiPool ??
  new Pool({ connectionString, max: maxConnections, idleTimeoutMillis: 30_000 });

if (process.env.NODE_ENV !== "production") globalForDb.__ushabtiPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
