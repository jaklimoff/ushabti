import { describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project, task } = await import("@/test/route");
const { db } = await import("@/test/db");
const { taskValues, views } = await import("@/db/schema");

/*
 * Both drivers hand jsonb over parsed. A second parse turned text that spells
 * a number or null into that number or nothing.
 */

type Read = {
  tasks: { id: string; values: Record<string, unknown> }[];
  properties: { id: string; name: string; type: string; options: { id: string }[] }[];
};

const WORDS = ["2.0", "1e3", "true", "null", "[]", '{"a":1}', "123", "hello"];

describe("A jsonb value", () => {
  it("reads text back as the words written, from the board and from one task", async () => {
    const owner = await person("Words Owner");
    const p = await project(owner);
    const me = api(owner);
    await ok(me.post(`/api/projects/${p.id}/properties`, { name: "Note", type: "text" }));
    const note = ((await board(owner, p.id)) as Read).properties.find((x) => x.name === "Note")!;

    const made: Record<string, string> = {};
    for (const words of WORDS) {
      const t = await task(owner, p.id, `Says ${words}`);
      await ok(me.put(`/api/tasks/${t.id}/values/${note.id}`, { value: words }));
      made[words] = t.id;
    }

    const read = (await board(owner, p.id)) as Read;
    for (const words of WORDS) {
      const t = read.tasks.find((x) => x.id === made[words])!;
      expect(t.values[note.id]).toBe(words);
      const one = (await ok(me.get(`/api/tasks/${made[words]}`))).task;
      expect(one.values[note.id]).toBe(words);
    }

    // Still stored as a jsonb string, so an eq() on the value answers.
    const [kind] = await db
      .select({ type: sql<string>`jsonb_typeof(${taskValues.value})` })
      .from(taskValues)
      .where(and(eq(taskValues.taskId, made["2.0"]), eq(taskValues.value, "2.0")));
    expect(kind?.type).toBe("string");
  });

  it("reads an object, an array, a number, a boolean and a null as before", async () => {
    const owner = await person("Shapes Owner");
    const p = await project(owner);
    const me = api(owner);
    const t = await task(owner, p.id, "Shapes");
    for (const [name, type] of [
      ["Points", "number"],
      ["Blocked", "checkbox"],
    ] as const)
      await ok(me.post(`/api/projects/${p.id}/properties`, { name, type }));
    const props = ((await board(owner, p.id)) as Read).properties;
    const id = (name: string) => props.find((x) => x.name === name)!.id;

    await ok(me.put(`/api/tasks/${t.id}/values/${id("Points")}`, { value: 2.5 }));
    await ok(me.put(`/api/tasks/${t.id}/values/${id("Blocked")}`, { value: true }));

    const values = ((await board(owner, p.id)) as Read).tasks.find((x) => x.id === t.id)!.values;
    expect(values[id("Points")]).toBe(2.5);
    expect(values[id("Blocked")]).toBe(true);

    // An array goes in through the column and is stored as a jsonb array.
    const [row] = await db
      .insert(taskValues)
      .values({ taskId: t.id, propertyId: id("Points"), value: [1, "x", null] })
      .onConflictDoUpdate({
        target: [taskValues.taskId, taskValues.propertyId],
        set: { value: [1, "x", null] },
      })
      .returning({ value: taskValues.value, type: sql<string>`jsonb_typeof(${taskValues.value})` });
    expect(row).toEqual({ value: [1, "x", null], type: "array" });

    // An object and a null read back as they were written.
    const [view] = await db
      .select({ config: views.config, cardView: views.cardView })
      .from(views)
      .where(eq(views.projectId, p.id))
      .limit(1);
    expect(view.config).toBeTypeOf("object");
    expect(view.cardView).toBeNull();
  });
});
