import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project } = await import("@/test/route");

/*
 * The server's half of a view that changes kind, and of a view's own card
 * view. Each test was a test of `e2e/list.spec.ts` or `e2e/card-view.spec.ts`,
 * and carries its name. What the screen draws of them is in `List.test.tsx`
 * and `CardViewPanel.test.tsx`.
 */

type View = { id: string; name: string; kind: string; groupById: string | null };
type Property = { id: string; name: string };

async function setUp() {
  const owner = await person("Views Owner");
  const p = await project(owner);
  const read = await board(owner, p.id);
  const view = (name: string) => (read.views as View[]).find((v) => v.name === name)!;
  const property = (name: string) => (read.properties as Property[]).find((x) => x.name === name)!;
  return { owner, project: p, me: api(owner), view, property };
}

describe("A list view", () => {
  it("keeps its columns when it becomes a board and comes back", async () => {
    const { owner, project: p, me, view } = await setUp();
    const phases = view("Phases");

    await ok(me.patch(`/api/views/${phases.id}`, { kind: "list" }));
    const asList = (await board(owner, p.id)).views.find((v: View) => v.id === phases.id);
    expect(asList.kind).toBe("list");
    // A list never reads it, and still keeps it.
    expect(asList.groupById).toBe(phases.groupById);

    await ok(me.patch(`/api/views/${phases.id}`, { kind: "board" }));
    const back = (await board(owner, p.id)).views.find((v: View) => v.id === phases.id);
    expect(back.groupById).toBe(phases.groupById);
  });

  it("can be made on a project with nothing to group by", async () => {
    const { owner, project: p, me, view, property } = await setUp();

    // Take away every property a board could use for its columns, as the spec
    // did: Phases goes, the main view becomes a list, and the three go.
    await ok(me.del(`/api/views/${view("Phases").id}`));
    await ok(me.patch(`/api/views/${view("Board").id}`, { kind: "list" }));
    for (const name of ["Status", "Assignee", "Phase"]) {
      await ok(me.del(`/api/properties/${property(name).id}`));
    }

    // A list needs no property to group by.
    const { view: made } = await ok<{ view: View }>(
      me.post(`/api/projects/${p.id}/views`, {
        name: "Second list",
        kind: "list",
        groupById: null,
      }),
    );
    expect(made).toMatchObject({ name: "Second list", kind: "list" });
    const names = (await board(owner, p.id)).views.map((v: View) => v.name);
    expect(names).toContain("Second list");
  });

  it("does not pin the property it once grouped by", async () => {
    const { me, view, property } = await setUp();
    const phase = property("Phase");

    // A board refuses it: the view would have nothing to make columns from.
    const refused = await me.del(`/api/properties/${phase.id}`);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain("Phases");

    // A list remembers the property but never reads one, and a remembered word
    // must not hold a property nobody is using.
    await ok(me.patch(`/api/views/${view("Phases").id}`, { kind: "list" }));
    await ok(me.del(`/api/properties/${phase.id}`));
  });
});

describe("A view's own card view", () => {
  /* The route's half of "a view's menu arranges a card view for that view only". */
  it("a copy must say where its rows sit; a body without them is refused", async () => {
    const { me, view } = await setUp();
    const answer = await me.patch(`/api/views/${view("Phases").id}/card-view`, { cardView: {} });
    expect(answer.status).toBe(400);
  });
});
