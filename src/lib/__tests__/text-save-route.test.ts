import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, join, ok, person, project, task } = await import("@/test/route");

/*
 * The server's half of a text save that crossed another write. It was a test
 * of `e2e/text-save.spec.ts`, and carries its name. What the fields ask is in
 * `TextSave.test.tsx`.
 */

type Property = { id: string; name: string; options: { id: string }[] };

describe("A text save does not overwrite a change it did not see", () => {
  it("a Priority change and a tick do not refuse a description", async () => {
    const anna = await person("Anna Owner");
    const ben = await person("Ben Friend");
    const p = await project(anna);
    await join(p.id, ben, "member");
    const t = await task(anna, p.id, "Shared words");
    const { item } = await ok<{ item: { id: string } }>(
      api(anna).post(`/api/tasks/${t.id}/checklist`, { text: "Tick me" }),
    );

    // Ben opened the description while it was empty. Anna changes the task
    // around it: a value and a tick, neither of them its words.
    const priority = ((await board(anna, p.id)).properties as Property[]).find(
      (x) => x.name === "Priority",
    )!;
    await ok(
      api(anna).put(`/api/tasks/${t.id}/values/${priority.id}`, {
        value: priority.options[0].id,
      }),
    );
    await ok(api(anna).patch(`/api/checklist/${item.id}`, { done: true }));

    await ok(
      api(ben).patch(`/api/tasks/${t.id}`, {
        description: "Words after a tick.",
        baseDescription: "",
      }),
    );
    const { task: read } = await ok<{ task: { description: string } }>(
      api(anna).get(`/api/tasks/${t.id}`),
    );
    expect(read.description).toBe("Words after a tick.");
  });
});
