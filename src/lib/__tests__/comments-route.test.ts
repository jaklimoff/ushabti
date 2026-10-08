import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, join, ok, person, project, task } = await import("@/test/route");

/*
 * Who may change or take down a comment. Each test was a test of
 * `e2e/comment-edit.spec.ts` or `e2e/comment-delete.spec.ts`, and carries its
 * name. What the panel draws of them is in `Comments.test.tsx`.
 */

type Comment = { id: string; body: string };
type Activity = { kind: string; data: Record<string, unknown>; actor: { name: string } | null };

/** Anna owns a project with one task and one comment of hers; Ben is a member. */
async function oneComment() {
  const anna = await person("Anna Owner");
  const ben = await person("Ben Friend");
  const p = await project(anna);
  await join(p.id, ben, "member");
  const t = await task(anna, p.id, "Talked about");
  const { comment } = await ok<{ comment: Comment }>(
    api(anna).post(`/api/tasks/${t.id}/comments`, { body: "The tests are gren" }),
  );
  return { anna, ben, project: p, task: t, comment };
}

describe("The author of a comment can edit it", () => {
  it("somebody else's comment answers 403, the owner's included", async () => {
    const { anna, ben, task: t, comment } = await oneComment();

    const refused = await api(ben).patch(`/api/comments/${comment.id}`, { body: "Ben's words" });
    expect(refused.status).toBe(403);

    // Ben's own comment, which Anna owns the project around.
    const { comment: bens } = await ok<{ comment: Comment }>(
      api(ben).post(`/api/tasks/${t.id}/comments`, { body: "Mine" }),
    );
    const owner = await api(anna).patch(`/api/comments/${bens.id}`, { body: "Anna's words" });
    expect(owner.status).toBe(403);

    const empty = await api(anna).patch(`/api/comments/${comment.id}`, { body: "  " });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/Delete it instead/);
  });
});

describe("Deleting a comment", () => {
  /* The route half of "a member cannot delete somebody's comment, an admin
     can, and both are asked first". The question is `Comments.test.tsx`. */
  it("a member cannot delete somebody's comment, an admin can", async () => {
    const { anna, ben, project: p, task: t, comment } = await oneComment();

    const refused = await api(ben).del(`/api/comments/${comment.id}`);
    expect(refused.status).toBe(403);

    // His own words he may always take back.
    const { comment: bens } = await ok<{ comment: Comment }>(
      api(ben).post(`/api/tasks/${t.id}/comments`, { body: "Ben says hi" }),
    );
    await ok(api(ben).del(`/api/comments/${bens.id}`));

    // Made an admin, he may take Anna's down.
    await ok(api(anna).patch(`/api/projects/${p.id}/members/${ben.id}`, { role: "admin" }));
    await ok(api(ben).del(`/api/comments/${comment.id}`));

    const { task: read } = await ok<{
      task: { comments: Comment[]; activity: Activity[] };
    }>(api(anna).get(`/api/tasks/${t.id}`));
    expect(read.comments).toEqual([]);
    // The feed says who deleted whose comment, and not what it said.
    const deleted = read.activity.filter(
      (a) => a.kind === "comment" && a.data.action === "deleted",
    );
    expect(deleted.map((a) => [a.actor?.name, a.data.authorId])).toContainEqual([
      "Ben Friend",
      anna.id,
    ]);
    expect(JSON.stringify(read.activity)).not.toContain("The tests are gren");
  });
});
