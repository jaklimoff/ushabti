import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * The two board readers of the chain ask for blocker rows by kind, so a
 * parent row never reaches a card or the circle check. The fake keeps the
 * condition each read was asked with, and the test reads it as SQL.
 */
const fake = vi.hoisted(() => {
  let where: unknown = null;
  const node = {
    select: () => node,
    from: () => node,
    innerJoin: () => node,
    where: (clause: unknown) => {
      where = clause;
      return Promise.resolve([]);
    },
  };
  return { db: node, where: () => where };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));

const { projectLinks, waitingLinks } = await import("../queries");

function asked() {
  return new PgDialect().sqlToQuery(fake.where() as SQL);
}

describe("the kind of a link", () => {
  it("the circle check reads only blocker rows", async () => {
    await projectLinks("p1", fake.db as never);
    const { sql, params } = asked();
    expect(sql).toContain('"task_links"."kind" = $');
    expect(params).toContain("blocks");
    expect(params).not.toContain("parent");
  });

  it("the one-level check reads only parent rows", async () => {
    await projectLinks("p1", fake.db as never, "parent");
    const { params } = asked();
    expect(params).toContain("parent");
    expect(params).not.toContain("blocks");
  });

  it("the board load reads only blocker rows for the chain on a card", async () => {
    await waitingLinks(["t1", "t2"]);
    const { sql, params } = asked();
    expect(sql).toContain('"task_links"."kind" = $');
    expect(params).toContain("blocks");
    expect(params).not.toContain("parent");
  });
});
