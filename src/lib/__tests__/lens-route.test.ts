import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/db");
const { viewLenses } = await import("@/db/schema");
const { api, board, ok, person, project } = await import("@/test/route");

/*
 * What the lens routes refuse, keep and read back. Each test here was a test
 * of `e2e/filters.spec.ts` and carries its name. The reloads, the closed tab,
 * the two tabs, the deleted option on the board and the zones stayed there.
 */

type Option = { id: string; name: string };
type Property = { id: string; name: string; options: Option[] };
type View = {
  id: string;
  filters: { rules: unknown[] };
  lens: { rules: unknown[] };
  sort: unknown;
  lensSort: unknown;
};

const CLASH = "The view already filters Priority. Remove it for everyone first.";

async function setUp() {
  const owner = await person("Lens Owner");
  const p = await project(owner);
  const me = api(owner);
  const read = async () => {
    const b = await board(owner, p.id);
    return { views: b.views as View[], properties: b.properties as Property[] };
  };
  const first = await read();
  const view = first.views[0];
  const property = (name: string) => first.properties.find((x) => x.name === name)!;
  const option = (prop: string, name: string) =>
    property(prop).options.find((o) => o.name === name)!.id;
  const viewNow = async () => (await read()).views.find((v) => v.id === view.id)!;
  return { owner, project: p, me, view, property, option, viewNow };
}

/** The lens row as it sits in the table, not as the board reads it. */
async function savedLens(viewId: string) {
  const [row] = await db.select().from(viewLenses).where(eq(viewLenses.viewId, viewId));
  return (row?.filters ?? null) as { rules: unknown[]; sort?: unknown } | null;
}

describe("Filters inside a view", () => {
  it("Save for everyone refuses a rule about a property the view filters", async () => {
    const { me, view, property, option, viewNow } = await setUp();
    const priority = property("Priority");
    const ofView = { propertyId: priority.id, op: "is", values: [option("Priority", "Urgent")] };
    const mine = { propertyId: priority.id, op: "is", values: [option("Priority", "High")] };

    /* Mine goes on first, when the view asks nothing and there is no clash to
       see. The view takes that property afterwards, which is the one way the
       two sets can ever hold one property: both doors refuse it from now on. */
    await ok(me.put(`/api/views/${view.id}/lens`, { filters: { rules: [mine] } }));
    await ok(me.patch(`/api/views/${view.id}`, { filters: { rules: [ofView] } }));

    const promoted = await me.post(`/api/views/${view.id}/lens/promote`);
    expect(promoted.status).toBe(409);
    expect((await promoted.json()).error).toBe(CLASH);

    // Nothing moved: the view keeps its one rule, and mine is still mine.
    const kept = await viewNow();
    expect(kept.filters.rules).toEqual([ofView]);
    expect(kept.lens.rules).toEqual([mine]);
  });

  it("writing a lens refuses a property the view already filters", async () => {
    const { me, view, property, option } = await setUp();
    const priority = property("Priority");
    const ofView = { propertyId: priority.id, op: "is", values: [option("Priority", "Urgent")] };
    const mine = { propertyId: priority.id, op: "is", values: [option("Priority", "High")] };

    await ok(me.patch(`/api/views/${view.id}`, { filters: { rules: [ofView] } }));

    const refused = await me.put(`/api/views/${view.id}/lens`, { filters: { rules: [mine] } });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe(CLASH);

    // Nothing was written, so there is no second rule waiting to be promoted.
    expect(await savedLens(view.id)).toBeNull();

    // Another property is still mine to ask about.
    const status = property("Status");
    const todo = option("Status", "Todo");
    const taken = await me.put(`/api/views/${view.id}/lens`, {
      filters: { rules: [{ propertyId: status.id, op: "is", values: [todo] }] },
    });
    expect(taken.ok).toBe(true);
  });

  /* A lens is saved once and read for months, so it outlives what it names.
     Both readings are here: the one on the write, and the one the board does. */
  it("a lens drops a rule that names nothing, written and read alike", async () => {
    const { me, view, property, option, viewNow } = await setUp();
    const priority = property("Priority");
    const urgent = option("Priority", "Urgent");

    // A property that is gone, an option that is gone, and one live rule.
    await ok(
      me.put(`/api/views/${view.id}/lens`, {
        filters: {
          rules: [
            { propertyId: "11111111-1111-1111-1111-111111111111", op: "is", values: ["nothing"] },
            { propertyId: priority.id, op: "is", values: [urgent, "22222222-gone"] },
          ],
        },
      }),
    );

    // The write read them first, so the row itself holds only what can be read.
    expect(await savedLens(view.id)).toEqual({
      rules: [{ propertyId: priority.id, op: "is", values: [urgent] }],
    });

    // The board says the same, because it reads the row afresh again.
    expect((await viewNow()).lens.rules).toEqual([
      { propertyId: priority.id, op: "is", values: [urgent] },
    ]);

    // Now the option goes, under a lens nobody rewrites. The row still names
    // it; the board must not, or a rule nobody can see keeps hiding cards.
    await ok(me.del(`/api/options/${urgent}`));
    expect((await savedLens(view.id))?.rules).toHaveLength(1);
    expect((await viewNow()).lens.rules).toEqual([]);
  });
});

/* An order a person picked lives in their lens beside the rules, and is read
   afresh the same way: a column that is gone must stop ordering anything. */
describe("An order in a lens", () => {
  it("is dropped when the column it names is deleted", async () => {
    const { owner, project: p, me, view, viewNow } = await setUp();
    await ok(me.post(`/api/projects/${p.id}/properties`, { name: "Effort", type: "number" }));
    const effort = ((await board(owner, p.id)).properties as Property[]).find(
      (x) => x.name === "Effort",
    )!;

    await ok(
      me.put(`/api/views/${view.id}/lens`, {
        filters: { rules: [] },
        sort: { columnId: effort.id, direction: "desc" },
      }),
    );
    // An order alone is a lens: the row is kept, and the view is not touched.
    expect(await savedLens(view.id)).toEqual({
      rules: [],
      sort: { columnId: effort.id, direction: "desc" },
    });
    const read = await viewNow();
    expect(read.lensSort).toEqual({ columnId: effort.id, direction: "desc" });
    expect(read.sort).toBeNull();

    // The property goes, under a lens nobody rewrites.
    await ok(me.del(`/api/properties/${effort.id}`));
    expect(await savedLens(view.id)).toMatchObject({ sort: { columnId: effort.id } });
    expect((await viewNow()).lensSort).toBeNull();

    // And Save for everyone carries nothing of it to the view.
    await ok(me.post(`/api/views/${view.id}/lens/promote`));
    expect((await viewNow()).sort).toBeNull();
  });
});
