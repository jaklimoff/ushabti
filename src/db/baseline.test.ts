import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SQL } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { baseline, type QueryClient } from "../../scripts/baseline.mjs";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: { tag: string; when: number }[];
};

// Holds the migrations table the way Postgres does: a bigint comes back as a
// string, which is what makes a second run compare two different types.
function fakeDatabase() {
  const table: { hash: string; created_at: string }[] = [];
  const statements: string[] = [];
  const client: QueryClient = {
    async query(text, values) {
      statements.push(text);
      if (/^select/i.test(text)) {
        const rows = table.map((row) => ({ ...row }));
        // The migrator reads only the newest row, and trusts the order.
        if (/order by created_at desc/i.test(text)) {
          rows.sort((a, b) => Number(b.created_at) - Number(a.created_at));
        }
        return { rows };
      }
      if (/^insert/i.test(text)) {
        const [hash, createdAt] = values as [string, number];
        table.push({ hash, created_at: String(createdAt) });
      }
      return { rows: [] };
    },
  };
  return { client, table, statements };
}

describe("db:baseline", () => {
  it("marks every journal entry with the hash and time the drizzle migrator writes", async () => {
    const db = fakeDatabase();
    const written = await baseline(db.client, "./drizzle");

    expect(written).toBe(journal.entries.length);
    expect(db.table).toEqual(
      journal.entries.map((entry) => ({
        hash: createHash("sha256")
          .update(readFileSync(`drizzle/${entry.tag}.sql`).toString())
          .digest("hex"),
        created_at: String(entry.when),
      })),
    );
  });

  it("touches no schema but the migrations table, in one transaction", async () => {
    const db = fakeDatabase();
    await baseline(db.client, "./drizzle");

    expect(db.statements[0]).toBe("BEGIN");
    expect(db.statements.at(-1)).toBe("COMMIT");
    for (const text of db.statements) {
      if (/^(CREATE|INSERT|ALTER|DROP|UPDATE|DELETE)/.test(text)) {
        expect(text).toMatch(/"drizzle"/);
      }
    }
  });

  it("leaves the drizzle migrator nothing to run", async () => {
    const db = fakeDatabase();
    await baseline(db.client, "./drizzle");

    // The migrator's own code, over the same table, records every statement
    // it would send. A migration it replayed would show up here.
    const dialect = new PgDialect();
    const sent: string[] = [];
    const run = async (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      sent.push(text);
      return (await db.client.query(text.trim(), params)).rows;
    };
    const session = {
      execute: run,
      all: run,
      transaction: async (work: (tx: { execute: typeof run }) => Promise<void>) =>
        work({ execute: run }),
    };
    await dialect.migrate(
      readMigrationFiles({ migrationsFolder: "./drizzle" }),
      session as unknown as Parameters<PgDialect["migrate"]>[1],
      { migrationsFolder: "./drizzle" },
    );

    expect(sent.every((text) => /"drizzle"/.test(text))).toBe(true);
    expect(sent.some((text) => /insert into/i.test(text))).toBe(false);
  });

  it("changes nothing when it runs a second time", async () => {
    const db = fakeDatabase();
    await baseline(db.client, "./drizzle");
    const before = [...db.table];

    expect(await baseline(db.client, "./drizzle")).toBe(0);
    expect(db.table).toEqual(before);
  });
});
