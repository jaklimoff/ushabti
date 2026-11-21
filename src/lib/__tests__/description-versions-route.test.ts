import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/db");
const { agent, api, join, ok, person, project, task } = await import("@/test/route");

type Caller = Awaited<ReturnType<typeof person>>;
type Line = { kind: string; data: Record<string, unknown> };
type Version = {
  id: string;
  before: string;
  after: string;
  createdAt: string;
  actor: { id: string; name: string; kind: string } | null;
};

/** The description lines of a task, oldest first. */
async function lines(_who: Caller, taskId: string): Promise<Line[]> {
  const { rows } = await db.execute<Line>(
    sql`select kind, data from activity
         where task_id = ${taskId} and kind = 'description'
         order by created_at, id`,
  );
  return rows;
}

async function version(who: Caller, taskId: string, versionId: unknown): Promise<Version> {
  return (
    await ok<{ version: Version }>(
      api(who).get(`/api/tasks/${taskId}/description-versions/${versionId}`),
    )
  ).version;
}

async function count(taskId: string): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from description_versions where task_id = ${taskId}`,
  );
  return rows[0].n;
}

/** Moves every version of a task into the past, as a burst that ended would be. */
async function backdate(taskId: string, minutes: number) {
  await db.execute(sql`
    update description_versions
       set created_at = created_at - (${String(minutes)} || ' minutes')::interval
     where task_id = ${taskId}`);
}

describe("A description edit keeps the text it replaced", () => {
  it("writes a version with both texts, and its line names it", async () => {
    const anna = await person("Anna Owner");
    const p = await project(anna);
    const t = await task(anna, p.id, "Words");

    await ok(api(anna).patch(`/api/tasks/${t.id}`, { description: "First." }));
    const [line] = await lines(anna, t.id);
    expect(typeof line.data.versionId).toBe("string");
    // The old text stays out of the feed and the webhooks.
    expect(Object.keys(line.data)).toEqual(["versionId"]);

    const v = await version(anna, t.id, line.data.versionId);
    expect(v).toMatchObject({ before: "", after: "First.", actor: { id: anna.id } });

    // The same words again change nothing, and the line is as it was.
    await ok(api(anna).patch(`/api/tasks/${t.id}`, { description: "First." }));
    expect((await lines(anna, t.id))[1].data).toEqual({});
    expect(await count(t.id)).toBe(1);
  });

  it("shares one version across a burst by one actor, and starts another for somebody else", async () => {
    const anna = await person("Anna Owner");
    const ben = await person("Ben Friend");
    const p = await project(anna);
    await join(p.id, ben, "member");
    const t = await task(anna, p.id, "Burst");

    await ok(api(anna).patch(`/api/tasks/${t.id}`, { description: "One" }));
    await backdate(t.id, 2);
    await ok(api(anna).patch(`/api/tasks/${t.id}`, { description: "One two" }));
    const [a, b] = await lines(anna, t.id);
    expect(b.data.versionId).toBe(a.data.versionId);
    expect(await count(t.id)).toBe(1);
    expect(await version(anna, t.id, a.data.versionId)).toMatchObject({
      before: "",
      after: "One two",
    });

    await ok(api(ben).patch(`/api/tasks/${t.id}`, { description: "One two three" }));
    const c = (await lines(anna, t.id))[2];
    expect(c.data.versionId).not.toBe(a.data.versionId);
    expect(await version(anna, t.id, c.data.versionId)).toMatchObject({
      before: "One two",
      after: "One two three",
      actor: { id: ben.id },
    });

    // After ten minutes the same actor starts a new one.
    await backdate(t.id, 11);
    await ok(api(ben).patch(`/api/tasks/${t.id}`, { description: "Four" }));
    expect((await lines(anna, t.id))[3].data.versionId).not.toBe(c.data.versionId);
    expect(await count(t.id)).toBe(3);
  });

  it("answers 409 to a stale base and writes no version and no line", async () => {
    const anna = await person("Anna Owner");
    const p = await project(anna);
    const t = await task(anna, p.id, "Stale");
    await ok(api(anna).patch(`/api/tasks/${t.id}`, { description: "Saved." }));

    const res = await api(anna).patch(`/api/tasks/${t.id}`, {
      description: "Mine.",
      baseDescription: "Something else.",
    });
    expect(res.status).toBe(409);
    expect(await count(t.id)).toBe(1);
    expect(await lines(anna, t.id)).toHaveLength(1);
  });

  it("takes restoredFrom only for the version's own before, and names whose edit was put back", async () => {
    const anna = await person("Anna Owner");
    const p = await project(anna);
    const reis = await agent(anna, p.id, "Reis");
    const t = await task(anna, p.id, "Put back");
    const other = await task(anna, p.id, "Other");

    await ok(api(anna).patch(`/api/tasks/${t.id}`, { description: "Anna's words." }));
    await ok(reis.api.patch(`/api/tasks/${t.id}`, { description: "Reis wrote over it." }));
    const written = (await lines(anna, t.id))[1].data.versionId as string;
    await ok(api(anna).patch(`/api/tasks/${other.id}`, { description: "Elsewhere." }));
    const elsewhere = (await lines(anna, other.id))[0].data.versionId as string;

    // Not the version's before.
    const wrong = await api(anna).patch(`/api/tasks/${t.id}`, {
      description: "Something else.",
      restoredFrom: written,
    });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toMatch(/\.$/);
    // Another task's version.
    const foreign = await api(anna).patch(`/api/tasks/${t.id}`, {
      description: "",
      restoredFrom: elsewhere,
    });
    expect(foreign.status).toBe(400);
    expect(await count(t.id)).toBe(2);

    await ok(
      api(anna).patch(`/api/tasks/${t.id}`, {
        description: "Anna's words.",
        restoredFrom: written,
      }),
    );
    const put = (await lines(anna, t.id))[2];
    expect(put.data).toEqual({
      versionId: expect.any(String),
      restoredFrom: written,
      restoredActorId: reis.id,
    });
    expect(put.data.versionId).not.toBe(written);

    // A put-back is never moved by a later edit, even the same actor's.
    await ok(api(anna).patch(`/api/tasks/${t.id}`, { description: "Anna again." }));
    const after = (await lines(anna, t.id))[3];
    expect(after.data.versionId).not.toBe(put.data.versionId);
    expect(await version(anna, t.id, put.data.versionId)).toMatchObject({
      before: "Reis wrote over it.",
      after: "Anna's words.",
    });
  });

  it("is read by a member and an agent, and is 404 for another task or a stranger", async () => {
    const anna = await person("Anna Owner");
    const ben = await person("Ben Friend");
    const stranger = await person("Sam Stranger");
    const p = await project(anna);
    await join(p.id, ben, "member");
    const reis = await agent(anna, p.id, "Reis");
    const t = await task(anna, p.id, "Read");
    const other = await task(anna, p.id, "Other");

    await ok(api(anna).patch(`/api/tasks/${t.id}`, { description: "Hers." }));
    const id = (await lines(anna, t.id))[0].data.versionId as string;

    expect((await version(ben, t.id, id)).after).toBe("Hers.");
    const read = (
      await ok<{ version: Version }>(reis.api.get(`/api/tasks/${t.id}/description-versions/${id}`))
    ).version;
    expect(read).toMatchObject({
      id,
      before: "",
      after: "Hers.",
      actor: { id: anna.id, name: "Anna Owner", kind: "human" },
    });
    expect(typeof read.createdAt).toBe("string");

    expect((await api(anna).get(`/api/tasks/${other.id}/description-versions/${id}`)).status).toBe(
      404,
    );
    expect((await api(stranger).get(`/api/tasks/${t.id}/description-versions/${id}`)).status).toBe(
      404,
    );
  });
});
