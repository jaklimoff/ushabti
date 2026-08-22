// Applies every SQL file in ./drizzle that the database has not seen yet.
// Plain JavaScript on purpose: the production image installs no dev packages,
// so this must run with nothing but `pg` and `drizzle-orm`.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 1 });

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
} catch (error) {
  console.error("migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
