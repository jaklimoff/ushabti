import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://ushabti:ushabti@localhost:5435/ushabti";

// Next.js reloads modules during development. Keep one pool on globalThis so
// the process does not run out of Postgres connections.
const globalForDb = globalThis as unknown as { __ushabtiPool?: Pool };

export const pool =
  globalForDb.__ushabtiPool ?? new Pool({ connectionString, max: 12, idleTimeoutMillis: 30_000 });

if (process.env.NODE_ENV !== "production") globalForDb.__ushabtiPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
