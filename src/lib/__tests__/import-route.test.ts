import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project } = await import("@/test/route");

/*
 * What an import writes. Each test here was a test of `e2e/import.spec.ts`
 * and carries its name. One Trello file through the page stayed there; the
 * page on a phone is `ImportPanel.test.tsx`.
 */

const FIXTURE = "e2e/fixtures/trello-small.json";

/** The file and the answer, as the page posts them. */
function form(mapping: Record<string, unknown> = {}) {
  const sent = new FormData();
  sent.set("file", new File([readFileSync(FIXTURE, "utf8")], "trello.json"));
  sent.set("mapping", JSON.stringify({ lists: {}, labels: {}, archived: false, ...mapping }));
  return sent;
}

type Property = { id: string; name: string; options: { id: string; name: string }[] };
type Task = { id: string; title: string; values: Record<string, unknown> };
type Board = { properties: Property[]; tasks: Task[] };

describe("Bringing a board in from Trello", () => {
  it("a card brings its labels, its due date, its checklist and its comments", async () => {
    const owner = await person("Ada Lovelace");
    const p = await project(owner);
    const me = api(owner);

    expect((await me.post(`/api/projects/${p.id}/import`, form())).status).toBe(201);

    const read = (await board(owner, p.id)) as Board;
    const property = (name: string) => read.properties.find((x) => x.name === name)!;
    const shipped = read.tasks.find((t) => t.title === "Ship the changelog")!;

    const labels = property("Labels");
    expect(
      (shipped.values[labels.id] as string[]).map(
        (id) => labels.options.find((o) => o.id === id)?.name,
      ),
    ).toEqual(["Release"]);
    expect(shipped.values[property("Due").id]).toBe("2026-03-04");

    const { task } = await ok(me.get(`/api/tasks/${shipped.id}`));
    const items = (task.checklist as { text: string }[]).map((i) => i.text);
    expect(items).toContain("Before: Draft it");
    expect(items).toContain("After: Post it");

    const talk = read.tasks.find((t) => t.title === "Talk to the team")!;
    const { task: talked } = await ok(me.get(`/api/tasks/${talk.id}`));
    const said = (talked.comments as { body: string }[]).map((c) => c.body).join("\n");
    expect(said).toContain("I will book the room.");
    expect(said).toContain("Let us do this after the release.");
  });

  it("an import brings no value its task does not show", async () => {
    const owner = await person("Ada Lovelace");
    const p = await project(owner);
    const me = api(owner);

    /* Due shows only on a task In Progress, so the due date of a card that
       lands in Done must not arrive. */
    await ok(me.post(`/api/projects/${p.id}/properties`, { name: "Due", type: "date" }));
    const before = (await board(owner, p.id)) as Board;
    const due = before.properties.find((x) => x.name === "Due")!;
    const status = before.properties.find((x) => x.name === "Status")!;
    const doing = status.options.find((o) => o.name === "In Progress")!;
    await ok(
      me.patch(`/api/properties/${due.id}`, {
        when: { propertyId: status.id, optionIds: [doing.id] },
      }),
    );

    expect((await me.post(`/api/projects/${p.id}/import`, form())).status).toBe(201);

    const after = (await board(owner, p.id)) as Board;
    const shipped = after.tasks.find((t) => t.title === "Ship the changelog")!;
    expect(shipped.values[status.id]).toBeTruthy();
    expect(shipped.values[status.id]).not.toBe(doing.id);
    expect(shipped.values).not.toHaveProperty(due.id);
  });
});
