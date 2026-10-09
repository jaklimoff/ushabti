import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db, pool } = await import("@/db");
const { projects, users } = await import("@/db/schema");
const { agent, api, join, ok, person, project } = await import("@/test/route");

/*
 * A person's own order of their projects: one rank on each membership, read
 * by `listProjects` and moved by naming the project a card landed after.
 */

type Who = Awaited<ReturnType<typeof person>>;

async function names(who: Who) {
  const { projects: list } = await ok<{ projects: { name: string }[] }>(
    api(who).get("/api/projects"),
  );
  return list.map((p) => p.name);
}

function move(who: Who, projectId: string, afterId: string | null) {
  return api(who).patch(`/api/projects/${projectId}/position`, { afterId });
}

describe("A person's order of their projects", () => {
  it("holds a drag, and puts a project at the top or after the one it landed on", async () => {
    const me = await person("Orderer");
    const a = await project(me, "Order A");
    await project(me, "Order B");
    const c = await project(me, "Order C");
    // Each new one goes to the top.
    expect(await names(me)).toEqual(["Order C", "Order B", "Order A"]);

    await ok(move(me, c.id, a.id));
    expect(await names(me)).toEqual(["Order B", "Order A", "Order C"]);

    await ok(move(me, a.id, null));
    expect(await names(me)).toEqual(["Order A", "Order B", "Order C"]);

    await ok(move(me, c.id, a.id));
    expect(await names(me)).toEqual(["Order A", "Order C", "Order B"]);
  });

  it("moves nobody else's list", async () => {
    const owner = await person("Order Owner");
    const other = await person("Order Other");
    const a = await project(owner, "Shared A");
    const b = await project(owner, "Shared B");
    await join(a.id, other, "member");
    await join(b.id, other, "member");
    const before = await names(other);

    await ok(move(owner, b.id, a.id));
    expect(await names(owner)).toEqual(["Shared A", "Shared B"]);
    expect(await names(other)).toEqual(before);
  });

  it("puts a project somebody joins at the top of their list, and again when they rejoin", async () => {
    const owner = await person("Joiner Owner");
    const me = await person("Joiner");
    await project(me, "Mine first");
    await project(me, "Mine second");
    const theirs = await project(owner, "Theirs");

    // Added by email, as an admin adds somebody with an account.
    const [mine] = await db.select().from(projects).where(eq(projects.name, "Mine first"));
    await ok(move(me, mine.id, null));
    await ok(api(owner).post(`/api/projects/${theirs.id}/members`, { email: await emailOf(me) }));
    expect((await names(me))[0]).toBe("Theirs");

    // Leaving takes the membership; coming back puts it on top again.
    await ok(move(me, theirs.id, mine.id));
    expect((await names(me))[0]).toBe("Mine first");
    await ok(api(me).del(`/api/projects/${theirs.id}/members/${me.id}`));
    await ok(api(owner).post(`/api/projects/${theirs.id}/members`, { email: await emailOf(me) }));
    expect((await names(me))[0]).toBe("Theirs");
  });

  it("refuses an agent token", async () => {
    const owner = await person("Agent Order Owner");
    const p = await project(owner);
    const bot = await agent(owner, p.id, "Orderbot");
    const res = await bot.api.patch(`/api/projects/${p.id}/position`, { afterId: null });
    expect(res.status).toBe(403);
  });

  it("answers 404 for a project the person is not on, and changes nothing", async () => {
    const owner = await person("Stranger Owner");
    const stranger = await person("Stranger");
    const p = await project(owner, "Not yours");
    await project(stranger, "Yours");
    const res = await move(stranger, p.id, null);
    expect(res.status).toBe(404);
    expect(await names(stranger)).toEqual(["Yours"]);
    expect(await names(owner)).toEqual(["Not yours"]);
  });
});

describe("The migration", () => {
  it("gives every person their projects in the order they were made", async () => {
    const me = await person("Old Order");
    const other = await person("Old Order Other");
    const made: { id: string }[] = [];
    for (const name of ["Old 1", "Old 2", "Old 3"]) made.push(await project(me, name));
    await join(made[0].id, other, "member");
    await join(made[2].id, other, "member");
    for (const [i, p] of made.entries()) {
      await db
        .update(projects)
        .set({ createdAt: new Date(Date.UTC(2020, 0, 1 + i)) })
        .where(eq(projects.id, p.id));
    }
    await ok(move(me, made[0].id, made[2].id));

    const sql = readFileSync("drizzle/0031_project_order.sql", "utf8");
    await pool.query(sql.split("--> statement-breakpoint")[1]);

    expect(await names(me)).toEqual(["Old 1", "Old 2", "Old 3"]);
    expect(await names(other)).toEqual(["Old 1", "Old 3"]);
    // And a project made after it still goes to the top.
    await project(me, "New");
    expect((await names(me))[0]).toBe("New");
  });
});

/* `person` makes up an address; the members route adds somebody by it. */
async function emailOf(who: Who) {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, who.id));
  return row.email;
}
