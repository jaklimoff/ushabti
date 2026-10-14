import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { projectMembers, projects, users } = await import("@/db/schema");
const { requests } = await import("@/test/headers");
const memberRoute = await import("@/app/api/projects/[projectId]/members/[userId]/route");
const { agent, api, board, join, ok, person, project, unique } = await import("@/test/route");

/*
 * Who may change the people and the structure of a project, and what the
 * board read sends for somebody who left. One file, because each file boots
 * its own database. Each test was a test of `e2e/roles.spec.ts` or
 * `e2e/former.spec.ts`, or the server half of one, and carries its name. The
 * member who adds and deletes nothing carries `@smoke` and stayed there; the
 * question before Make owner is `PeoplePanel.test.tsx`, and what the board
 * draws for somebody who left is `Former.test.tsx`.
 */

/** A PATCH of a member whose body is sent as it is, so it need not be JSON. */
function raw(headers: Record<string, string>, projectId: string, userId: string, text: string) {
  const req = new Request(`http://localhost/api/projects/${projectId}/members/${userId}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: text,
  });
  return requests.run(req, () =>
    memberRoute.PATCH(req, { params: Promise.resolve({ projectId, userId }) }),
  );
}

type Prop = { id: string; name: string; options: { id: string }[] };

describe("Roles", () => {
  it("an admin adds an agent and issues its token; a member and the agent cannot", async () => {
    const owner = await person("Olga Owner");
    const admin = await person("Ada Admin");
    const member = await person("Bob Member");
    const p = await project(owner);
    await join(p.id, admin, "member");
    await join(p.id, member, "member");
    await ok(api(owner).patch(`/api/projects/${p.id}/members/${admin.id}`, { role: "admin" }));

    /* ---- a member is refused ------------------------------------------ */

    const refused = await api(member).post(`/api/projects/${p.id}/agents`, { name: "Nope" });
    expect(refused.status).toBe(403);

    /* ---- the admin adds an agent and issues its token ----------------- */

    const helper = await agent(admin, p.id, "Helper");
    expect(helper.secret).toMatch(/^ush_/);

    /* ---- people and structure are the admin's too -------------------- */

    const as = api(admin);
    const invited = `${unique("guest").replace(" ", "-")}@example.com`;
    await ok(as.post(`/api/projects/${p.id}/members`, { email: invited }));
    await ok(as.del(`/api/projects/${p.id}/invites/${encodeURIComponent(invited)}`));
    const read = await board(admin, p.id);
    const priority = (read.properties as Prop[]).find((x) => x.name === "Priority")!;
    const labels = (read.properties as Prop[]).find((x) => x.name === "Labels")!;
    await ok(as.del(`/api/options/${priority.options[0].id}`));
    await ok(as.del(`/api/properties/${labels.id}`));

    /* ---- what stays the owner's --------------------------------------- */

    expect((await as.del(`/api/projects/${p.id}`)).status).toBe(403);
    const bob = `/api/projects/${p.id}/members/${member.id}`;
    expect((await as.patch(bob, { role: "owner" })).status).toBe(403);
    expect((await as.del(`/api/projects/${p.id}/members/${owner.id}`)).status).toBe(403);

    // An admin may make a member an admin, and then cannot undo it or remove them.
    expect((await as.patch(bob, { role: "admin" })).status).toBe(200);
    expect((await as.patch(bob, { role: "member" })).status).toBe(403);
    expect((await as.del(bob)).status).toBe(403);

    /* ---- a token is a member, whoever issued it ----------------------- */

    const bot = helper.api;
    const tries = await Promise.all([
      bot.post(`/api/projects/${p.id}/agents`, { name: "Nope" }),
      bot.post(`/api/projects/${p.id}/members`, { email: "x@example.com" }),
      bot.get(`/api/projects/${p.id}/webhooks`),
      bot.patch(bob, { role: "member" }),
      // A person the project does not have, and a body that is no JSON: still 403.
      raw(helper.headers, p.id, crypto.randomUUID(), "not json"),
      bot.del(`/api/projects/${p.id}/members/${crypto.randomUUID()}`),
    ]);
    expect(tries.map((t) => t.status)).toEqual([403, 403, 403, 403, 403, 403]);
  });

  // The route half of "make owner asks first and leaves the old owner an admin".
  it("make owner leaves the old owner an admin", async () => {
    const owner = await person("Olga Owner");
    const next = await person("Nia Next");
    const p = await project(owner, unique("Handover"));
    await join(p.id, next, "member");

    await ok(api(owner).patch(`/api/projects/${p.id}/members/${next.id}`, { role: "owner" }));

    const rows = await db
      .select({ name: users.name, role: projectMembers.role })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, p.id))
      .orderBy(users.name);
    expect(rows).toEqual([
      { name: "Nia Next", role: "owner" },
      { name: "Olga Owner", role: "admin" },
    ]);
    const [row] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, p.id));
    expect(row.ownerId).toBe(next.id);

    // The delete is the owner's alone, so the old owner may no longer do it.
    expect((await api(owner).del(`/api/projects/${p.id}`)).status).toBe(403);
  });
});

type Read = {
  properties: { id: string; name: string }[];
  members: { id: string }[];
  former: { id: string; name: string }[];
  tasks: { title: string; values: Record<string, unknown> }[];
};

/** Grace joins, takes a task, and leaves through the same route People uses. */
async function graceLeft() {
  const ada = await person("Ada Lovelace");
  const grace = await person("Grace Hopper");
  const p = await project(ada);
  await join(p.id, grace, "member");
  const assignee = ((await board(ada, p.id)) as Read).properties.find(
    (x) => x.name === "Assignee",
  )!;
  await ok(
    api(ada).post(`/api/projects/${p.id}/tasks`, {
      title: "Grace's work",
      values: { [assignee.id]: grace.id },
    }),
  );
  await ok(api(ada).del(`/api/projects/${p.id}/members/${grace.id}`));
  return { ada, grace, project: p, assignee };
}

describe("Somebody who left", () => {
  it("is sent as former, and the task still names them", async () => {
    const { ada, grace, project: p, assignee } = await graceLeft();
    const read = (await board(ada, p.id)) as Read;
    expect(read.members.map((m) => m.id)).not.toContain(grace.id);
    expect(read.former).toEqual([expect.objectContaining({ id: grace.id, name: "Grace Hopper" })]);
    const work = read.tasks.find((t) => t.title === "Grace's work")!;
    expect(work.values[assignee.id]).toBe(grace.id);
  });

  it("somebody who rejoins reads as a member again", async () => {
    const { ada, grace, project: p } = await graceLeft();
    await join(p.id, grace, "member");
    const read = (await board(ada, p.id)) as Read;
    expect(read.former).toEqual([]);
    expect(read.members.map((m) => m.id)).toContain(grace.id);
  });
});
