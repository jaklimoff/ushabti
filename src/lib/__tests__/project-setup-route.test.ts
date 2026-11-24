import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, ok, person, project, task } = await import("@/test/route");
const { db } = await import("@/test/db");
const schema = await import("@/db/schema");
const { and, asc, eq, inArray, sql } = await import("drizzle-orm");

/*
 * The route half of "a new project can start with the setup of another one".
 * The pure copy is in `setup-copy.test.ts`; the form in `e2e/new-project-setup.spec.ts`.
 */

const { projects, projectMembers, properties, propertyOptions, views, tasks } = schema;

type Caller = Awaited<ReturnType<typeof person>>;

async function propsOf(projectId: string) {
  return db
    .select()
    .from(properties)
    .where(eq(properties.projectId, projectId))
    .orderBy(sql`${properties.position} COLLATE "C"`);
}

async function optionsOf(propertyIds: string[]) {
  if (!propertyIds.length) return [];
  return db
    .select()
    .from(propertyOptions)
    .where(inArray(propertyOptions.propertyId, propertyIds))
    .orderBy(asc(propertyOptions.propertyId), sql`${propertyOptions.position} COLLATE "C"`);
}

/** A source with a renamed option, a dated select, a view, a card and agent rules. */
async function source(owner: Caller) {
  const me = api(owner);
  const from = await project(owner, "Setup Source");
  const props = await propsOf(from.id);
  const status = props.find((p) => p.name === "Status")!;
  const statusOptions = await optionsOf([status.id]);
  const later = statusOptions[0];
  await ok(me.patch(`/api/options/${later.id}`, { name: "Someday" }));

  const version = await ok<{ property: { id: string } }>(
    me.post(`/api/projects/${from.id}/properties`, {
      name: "Version",
      type: "select",
      options: ["0.1", "0.2"],
    }),
  );
  const versionId = version.property.id;
  const [v1] = await optionsOf([versionId]);
  await db
    .update(properties)
    .set({ config: { dated: true } })
    .where(eq(properties.id, versionId));

  await ok(
    me.post(`/api/projects/${from.id}/views`, {
      name: "Shipping",
      kind: "board",
      groupById: versionId,
    }),
  );
  const shipping = (await db.select().from(views).where(eq(views.projectId, from.id))).find(
    (v) => v.name === "Shipping",
  )!;
  await db
    .update(views)
    .set({
      config: {
        startFolded: [v1.id],
        filters: {
          rules: [
            { propertyId: status.id, op: "is", values: [later.id] },
            { propertyId: versionId, op: "is", values: [v1.id] },
          ],
        },
      },
    })
    .where(eq(views.id, shipping.id));

  await db
    .update(projects)
    .set({
      agentRules: "Move the card to Ready when done.",
      releaseBy: versionId,
      cardView: { rows: { [status.id]: { place: "top", mode: "text" } } },
    })
    .where(eq(projects.id, from.id));

  await task(owner, from.id, "A task that stays behind");
  await agent(owner, from.id, "Stays Behind");
  await db.insert(schema.webhooks).values({
    projectId: from.id,
    url: "https://example.com/hook",
    secret: "x",
    prefix: "x",
  });
  return { from, status, later, versionId, v1, shipping };
}

describe("A new project made from the setup of another", () => {
  it("takes every property, option, view, the card, the pointers and the agent rules", async () => {
    const owner = await person("Setup Maker");
    const s = await source(owner);
    const { project: made } = await ok<{ project: { id: string } }>(
      api(owner).post("/api/projects", { name: "Setup Copy", from: s.from.id }),
    );

    const before = await propsOf(s.from.id);
    const after = await propsOf(made.id);
    expect(after.map((p) => [p.name, p.type, p.position, p.config])).toEqual(
      before.map((p) => [p.name, p.type, p.position, p.config]),
    );
    expect(after.some((p) => before.some((b) => b.id === p.id))).toBe(false);

    const status = after.find((p) => p.name === "Status")!;
    const version = after.find((p) => p.name === "Version")!;
    const statusOptions = await optionsOf([status.id]);
    const theirStatus = await optionsOf([s.status.id]);
    expect(statusOptions.map((o) => [o.name, o.color, o.icon, o.position])).toEqual(
      theirStatus.map((o) => [o.name, o.color, o.icon, o.position]),
    );
    expect(statusOptions[0].name).toBe("Someday");
    /* The dated select comes over empty. */
    expect(await optionsOf([version.id])).toEqual([]);

    const theirViews = await db
      .select()
      .from(views)
      .where(eq(views.projectId, s.from.id))
      .orderBy(sql`${views.position} COLLATE "C"`);
    const myViews = await db
      .select()
      .from(views)
      .where(eq(views.projectId, made.id))
      .orderBy(sql`${views.position} COLLATE "C"`);
    expect(myViews.map((v) => [v.name, v.kind, v.position, v.isDefault])).toEqual(
      theirViews.map((v) => [v.name, v.kind, v.position, v.isDefault]),
    );
    const shipping = myViews.find((v) => v.name === "Shipping")!;
    expect(shipping.groupById).toBe(version.id);
    /* The rule on the left-out version goes; the status rule points at the new option. */
    expect(shipping.config).toEqual({
      startFolded: [],
      filters: { rules: [{ propertyId: status.id, op: "is", values: [statusOptions[0].id] }] },
    });
    const main = myViews.find((v) => v.isDefault)!;
    expect(main.groupById).toBe(status.id);

    const [row] = await db.select().from(projects).where(eq(projects.id, made.id));
    const done = statusOptions.find((o) => o.name === "Done")!;
    expect(row.doneWhen).toEqual({ propertyId: status.id, optionIds: [done.id] });
    expect(row.releaseBy).toBe(version.id);
    expect(row.sprintBy).toBeNull();
    expect(row.cardView).toEqual({ rows: { [status.id]: { place: "top", mode: "text" } } });
    expect(row.agentRules).toBe("Move the card to Ready when done.");
    expect(row.publicChangelog).toBe(false);

    /* Nothing anywhere still names an id of the source. */
    const oldIds = [
      ...before.map((p) => p.id),
      ...(await optionsOf(before.map((p) => p.id))).map((o) => o.id),
    ];
    const written = JSON.stringify([row, after, myViews]);
    expect(oldIds.filter((id) => written.includes(id))).toEqual([]);
  });

  it("brings no tasks, people, agents, tokens, webhooks or lists", async () => {
    const owner = await person("Setup Maker");
    const other = await person("Somebody Else");
    const s = await source(owner);
    await db.insert(projectMembers).values({
      projectId: s.from.id,
      userId: other.id,
      role: "member",
      position: "a0",
    });
    const { project: made } = await ok<{ project: { id: string } }>(
      api(owner).post("/api/projects", { name: "Setup Copy", from: s.from.id }),
    );

    expect(await db.select().from(tasks).where(eq(tasks.projectId, made.id))).toEqual([]);
    const members = await db
      .select({ userId: projectMembers.userId, role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, made.id));
    expect(members).toEqual([{ userId: owner.id, role: "owner" }]);
    expect(
      await db.select().from(schema.agentTokens).where(eq(schema.agentTokens.projectId, made.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.webhooks).where(eq(schema.webhooks.projectId, made.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.listSources).where(eq(schema.listSources.projectId, made.id)),
    ).toEqual([]);
    const myViewIds = (
      await db.select({ id: views.id }).from(views).where(eq(views.projectId, made.id))
    ).map((v) => v.id);
    expect(
      await db.select().from(schema.viewLenses).where(inArray(schema.viewLenses.viewId, myViewIds)),
    ).toEqual([]);
  });

  it("answers 404 for a project the maker is not in, and writes nothing", async () => {
    const stranger = await person("Stranger");
    const owner = await person("Setup Owner");
    const theirs = await project(owner, "Not Yours");
    const count = async () =>
      (await db.select().from(projectMembers).where(eq(projectMembers.userId, stranger.id))).length;

    for (const from of [theirs.id, "00000000-0000-4000-8000-000000000000", "not-an-id"]) {
      const res = await api(stranger).post("/api/projects", { name: "Sneaky", from });
      expect(res.status).toBe(404);
    }
    expect(await count()).toBe(0);
    expect(
      await db
        .select()
        .from(projects)
        .where(and(eq(projects.ownerId, stranger.id))),
    ).toEqual([]);
  });

  it("is two projects afterwards: a change to one leaves the other", async () => {
    const owner = await person("Setup Maker");
    const s = await source(owner);
    const { project: made } = await ok<{ project: { id: string } }>(
      api(owner).post("/api/projects", { name: "Setup Copy", from: s.from.id }),
    );
    await ok(api(owner).patch(`/api/options/${s.later.id}`, { name: "Never" }));
    const status = (await propsOf(made.id)).find((p) => p.name === "Status")!;
    expect((await optionsOf([status.id]))[0].name).toBe("Someday");
  });

  it("with no source is made as before", async () => {
    const owner = await person("Setup Maker");
    const plain = await project(owner, "Plain");
    const { project: nulled } = await ok<{ project: { id: string } }>(
      api(owner).post("/api/projects", { name: "Nulled", from: null }),
    );
    const names = async (id: string) => (await propsOf(id)).map((p) => p.name);
    expect(await names(nulled.id)).toEqual(await names(plain.id));
    expect(await names(plain.id)).toEqual([
      "Status",
      "Priority",
      "Assignee",
      "Estimate",
      "Labels",
      "Due",
    ]);
  });
});
