import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project, task } = await import("@/test/route");

/*
 * The server's half of the tests in `e2e/properties.spec.ts` that needed a
 * reload to find what was saved. Each test carries the name of the spec test
 * it answers for. What the screen draws and sends is in
 * `PropertiesPanel.test.tsx`.
 */

type Option = { id: string; name: string };
type Property = { id: string; name: string; type: string; options: Option[] };
type Row = { id: string; values: Record<string, unknown> };
type Board = {
  properties: Property[];
  tasks: Row[];
  cardView: { rows: Record<string, { place: string }> };
};

async function setUp() {
  const owner = await person("Props Owner");
  const p = await project(owner);
  const read = async () => (await board(owner, p.id)) as Board;
  const property = async (name: string) => (await read()).properties.find((x) => x.name === name)!;
  return { owner, project: p, me: api(owner), read, property };
}

describe("Custom properties", () => {
  it("hide a property and it leaves the card", async () => {
    const { project: p, me, read, property } = await setUp();
    const priority = await property("Priority");
    const before = (await read()).cardView.rows[priority.id].place;
    expect(before).not.toBe("off");

    // The card view page writes the whole card view, with the row off.
    const view = (await read()).cardView;
    await ok(
      me.patch(`/api/projects/${p.id}/card-view`, {
        cardView: {
          ...view,
          rows: { ...view.rows, [priority.id]: { place: "off", mode: "text" } },
        },
      }),
    );
    expect((await read()).cardView.rows[priority.id].place).toBe("off");
  });

  it("showOnCard on the API still takes a property off the card and back", async () => {
    const { me, read, property } = await setUp();
    const priority = await property("Priority");
    const before = (await read()).cardView.rows[priority.id].place;
    expect(before).not.toBe("off");

    await ok(me.patch(`/api/properties/${priority.id}`, { showOnCard: false }));
    expect((await read()).cardView.rows[priority.id].place).toBe("off");

    await ok(me.patch(`/api/properties/${priority.id}`, { showOnCard: true }));
    expect((await read()).cardView.rows[priority.id].place).not.toBe("off");
  });

  it("delete a property and its values disappear", async () => {
    const { owner, project: p, me, read, property } = await setUp();
    const made = await task(owner, p.id, "Estimate goes away");
    const estimate = await property("Estimate");
    const xl = estimate.options.find((o) => o.name === "XL")!;
    await ok(me.put(`/api/tasks/${made.id}/values/${estimate.id}`, { value: xl.id }));
    expect((await read()).tasks.find((t) => t.id === made.id)!.values[estimate.id]).toBe(xl.id);

    // The cost it names is the count of what goes with it.
    const count = await ok<{ values: number }>(me.get(`/api/properties/${estimate.id}/count`));
    expect(count.values).toBe(1);

    await ok(me.del(`/api/properties/${estimate.id}`));
    const after = await read();
    expect(after.properties.map((x) => x.name)).not.toContain("Estimate");
    expect(after.tasks.find((t) => t.id === made.id)!.values[estimate.id]).toBeUndefined();
  });

  it("a property is dragged into its place, and stays there", async () => {
    const { me, read, property } = await setUp();
    const names = async () => (await read()).properties.map((x) => x.name);
    expect((await names()).slice(0, 2)).toEqual(["Status", "Priority"]);

    // Dropped onto Status, Priority lands after nothing.
    await ok(me.patch(`/api/properties/${(await property("Priority")).id}`, { afterId: null }));
    expect((await names()).slice(0, 2)).toEqual(["Priority", "Status"]);
  });

  it("the keyboard moves a property as well as the pointer", async () => {
    const { me, read, property } = await setUp();
    const priority = await property("Priority");
    // Status moves down one: it lands after Priority.
    await ok(
      me.patch(`/api/properties/${(await property("Status")).id}`, { afterId: priority.id }),
    );
    expect((await read()).properties.map((x) => x.name).slice(0, 2)).toEqual([
      "Priority",
      "Status",
    ]);
  });

  it("an option is dragged into its place, and the sort follows it", async () => {
    const { me, property } = await setUp();
    const priority = await property("Priority");
    const order = async () => (await property("Priority")).options.map((o) => o.name);
    expect(await order()).toEqual(["Urgent", "High", "Medium", "Low"]);

    // Low dropped onto Urgent lands after nothing; the board keeps that order.
    const low = priority.options.find((o) => o.name === "Low")!;
    await ok(me.patch(`/api/options/${low.id}`, { afterId: null }));
    expect(await order()).toEqual(["Low", "Urgent", "High", "Medium"]);
  });

  it("the keyboard moves an option, and the columns follow it", async () => {
    const { me, property } = await setUp();
    const status = await property("Status");
    expect(status.options.slice(0, 2).map((o) => o.name)).toEqual(["Backlog", "Todo"]);

    await ok(me.patch(`/api/options/${status.options[0].id}`, { afterId: status.options[1].id }));
    expect((await property("Status")).options.slice(0, 2).map((o) => o.name)).toEqual([
      "Todo",
      "Backlog",
    ]);
  });

  it("text, number and checkbox properties keep their value", async () => {
    const { owner, project: p, me, read } = await setUp();
    const made: Record<string, string> = {};
    for (const [name, type] of [
      ["Owner note", "text"],
      ["Points", "number"],
      ["Blocked", "checkbox"],
    ] as const) {
      await ok(me.post(`/api/projects/${p.id}/properties`, { name, type }));
    }
    for (const x of (await read()).properties) made[x.name] = x.id;
    const t = await task(owner, p.id, "All the types");

    await ok(me.put(`/api/tasks/${t.id}/values/${made["Owner note"]}`, { value: "Ask Ada" }));
    await ok(me.put(`/api/tasks/${t.id}/values/${made["Points"]}`, { value: 8 }));
    await ok(me.put(`/api/tasks/${t.id}/values/${made["Blocked"]}`, { value: true }));

    const values = (await read()).tasks.find((x) => x.id === t.id)!.values;
    expect(values[made["Owner note"]]).toBe("Ask Ada");
    expect(values[made["Points"]]).toBe(8);
    expect(values[made["Blocked"]]).toBe(true);
  });
});
