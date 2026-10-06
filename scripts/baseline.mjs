// Marks every migration in ./drizzle as applied, and runs none of them.
// The dev container builds its schema with `drizzle-kit push`, which writes no
// rows in drizzle.__drizzle_migrations, so `db:migrate` would replay
// 0000_init.sql onto tables that exist. After this, it runs only what is new.
// Plain JavaScript with `pg` and `drizzle-orm`, as scripts/migrate.mjs is.
import { readMigrationFiles } from "drizzle-orm/migrator";
import { pathToFileURL } from "node:url";
import pg from "pg";

// The schema, the table and the columns the drizzle migrator writes.
const CREATE_SCHEMA = `CREATE SCHEMA IF NOT EXISTS "drizzle"`;
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
)`;

/**
 * Writes the rows that are missing and returns how many it wrote. A row that
 * is already there, with the same hash and time, is left alone, so a second
 * run writes nothing.
 */
export async function baseline(client, migrationsFolder) {
  const migrations = readMigrationFiles({ migrationsFolder });
  await client.query("BEGIN");
  try {
    await client.query(CREATE_SCHEMA);
    await client.query(CREATE_TABLE);
    const { rows } = await client.query(
      `SELECT hash, created_at FROM "drizzle"."__drizzle_migrations"`,
    );
    const seen = new Set(rows.map((row) => `${row.hash}:${Number(row.created_at)}`));
    let written = 0;
    for (const migration of migrations) {
      if (seen.has(`${migration.hash}:${migration.folderMillis}`)) continue;
      await client.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
        [migration.hash, migration.folderMillis],
      );
      written += 1;
    }
    await client.query("COMMIT");
    return written;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const written = await baseline(client, "./drizzle");
    console.log(`baseline: ${written} migrations marked as applied`);
  } catch (error) {
    console.error("baseline failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
