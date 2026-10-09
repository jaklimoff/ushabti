import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project, unique } = await import("@/test/route");

/*
 * The server's half of the Types page and of what a new task of a type
 * starts with. Each test was a test of `e2e/types.spec.ts` or
 * `e2e/type-defaults.spec.ts`, and carries its name. What the page and the
 * composer draw is `TypesPanel.test.tsx`.
 */

type Property = {
  id: string;
  name: string;
  type: string;
  config: { defaults?: Record<string, unknown> };
  options: { id: string; name: string }[];
};
type Board = {
  project: { typeBy: string | null };
  properties: Property[];
  members: { id: string }[];
  tasks: { id: string; values: Record<string, unknown> }[];
};

describe("The Types page", () => {
  it("the project names a select as its Type, and only a select", async () => {
    const owner = await person("Type by");
    const p = await project(owner);
    const as = api(owner);
    await ok(
      as.post(`/api/projects/${p.id}/properties`, {
        name: "Type",
        type: "select",
        options: ["Bug", "Story"],
      }),
    );
    const read = async () => (await board(owner, p.id)) as Board;
    const type = (await read()).properties.find((x) => x.name === "Type")!;

    expect((await read()).project.typeBy).toBeNull();
    const { property: text } = await ok<{ property: Property }>(
      as.post(`/api/projects/${p.id}/properties`, { name: "Notes", type: "text" }),
    );
    expect((await as.patch(`/api/projects/${p.id}`, { typeBy: text.id })).status).toBe(400);
    const stranger = "00000000-0000-0000-0000-000000000000";
    expect((await as.patch(`/api/projects/${p.id}`, { typeBy: stranger })).status).toBe(400);

    await ok(as.patch(`/api/projects/${p.id}`, { typeBy: type.id }));
    expect((await read()).project.typeBy).toBe(type.id);

    // A deleted select reads as no Type, with nothing cleaned up.
    await ok(as.del(`/api/properties/${type.id}`));
    expect((await read()).project.typeBy).toBeNull();

    await ok(as.patch(`/api/projects/${p.id}`, { typeBy: "" }));
  });
});

/** A project typed by Bug and Story, where a Bug starts with Severity Minor. */
async function typed() {
  const owner = await person(unique("Starts as"));
  const p = await project(owner);
  const as = api(owner);
  const add = async (data: object) =>
    (await ok<{ property: Property }>(as.post(`/api/projects/${p.id}/properties`, data))).property;
  await add({ name: "Type", type: "select", options: ["Bug", "Story"] });
  await add({ name: "Severity", type: "select", options: ["Minor", "Major"] });
  await add({ name: "Owner", type: "person" });
  const read = async () => (await board(owner, p.id)) as Board;
  const first = await read();
  const of = (n: string) => first.properties.find((x) => x.name === n)!;
  const optionOf = (x: Property, n: string) => x.options.find((o) => o.name === n)!.id;
  const type = of("Type");
  const severity = of("Severity");
  const bug = optionOf(type, "Bug");
  const story = optionOf(type, "Story");
  const minor = optionOf(severity, "Minor");
  const major = optionOf(severity, "Major");
  await ok(as.patch(`/api/projects/${p.id}`, { typeBy: type.id }));
  await ok(
    as.patch(`/api/properties/${severity.id}`, {
      when: { propertyId: type.id, optionIds: [bug] },
    }),
  );
  await ok(as.patch(`/api/properties/${severity.id}`, { defaults: { [bug]: minor } }));

  /** Makes a task with `values`, and reads back what was stored. */
  const created = async (values: Record<string, unknown>) => {
    const res = await as.post(`/api/projects/${p.id}/tasks`, { title: unique("Task"), values });
    expect(res.status).toBe(201);
    const { task } = (await res.json()) as { task: { id: string; values: object } };
    const stored = (await read()).tasks.find((t) => t.id === task.id)!.values;
    // The answer is all a caller has to draw the new task from.
    expect(task.values).toEqual(stored);
    return stored;
  };
  const defaultsOf = async (propertyId: string) =>
    (await read()).properties.find((x) => x.id === propertyId)!.config.defaults;

  return { as, p, of, type, severity, bug, story, minor, major, created, defaultsOf, read };
}

describe("What a new task of a type starts with", () => {
  it("a create with only the type gets the default; a sent value wins", async () => {
    const { type, severity, bug, story, minor, major, created } = await typed();

    expect((await created({ [type.id]: bug }))[severity.id]).toBe(minor);
    expect((await created({ [type.id]: bug, [severity.id]: major }))[severity.id]).toBe(major);
    expect((await created({ [type.id]: bug, [severity.id]: null }))[severity.id] ?? null).toBe(
      null,
    );
    expect((await created({}))[severity.id]).toBeUndefined();
    expect((await created({ [type.id]: story }))[severity.id]).toBeUndefined();
  });

  it("a default its property's own rule hides is never written", async () => {
    const { as, type, severity, story, minor, created } = await typed();
    await ok(as.patch(`/api/properties/${severity.id}`, { defaults: { [story]: minor } }));
    // Severity shows only on a Bug, so a Story never carries it.
    expect((await created({ [type.id]: story }))[severity.id]).toBeUndefined();
  });

  it("a person, a stranger type and a value that does not read are refused", async () => {
    const { as, of, severity, bug, read } = await typed();
    const members = (await read()).members;
    const owner = `/api/properties/${of("Owner").id}`;
    expect((await as.patch(owner, { defaults: { [bug]: members[0].id } })).status).toBe(400);
    const url = `/api/properties/${severity.id}`;
    const stranger = { "00000000-0000-0000-0000-000000000000": severity.options[0].id };
    expect((await as.patch(url, { defaults: stranger })).status).toBe(400);
    expect((await as.patch(url, { defaults: { [bug]: "not an option" } })).status).toBe(400);
  });

  it("deleting the value or the type reads as no default, with no error", async () => {
    const first = await typed();
    await ok(first.as.del(`/api/options/${first.minor}`));
    expect(await first.defaultsOf(first.severity.id)).toBeUndefined();
    expect((await first.created({ [first.type.id]: first.bug }))[first.severity.id]).toBe(
      undefined,
    );

    const second = await typed();
    await ok(second.as.del(`/api/options/${second.bug}`));
    expect(await second.defaultsOf(second.severity.id)).toBeUndefined();
  });
});

/* The route half of "saves on blur, and on a tab closed while it has the
   focus" in `e2e/type-defaults.spec.ts`: what the box sends is kept, and a
   clear takes it away. What the box sends is `TypesPanel.test.tsx`. */
describe("A Starts as box", () => {
  it("saves on blur, and on a tab closed while it has the focus", async () => {
    const { as, p, bug, defaultsOf } = await typed();
    const { property: points } = await ok<{ property: Property }>(
      as.post(`/api/projects/${p.id}/properties`, { name: "Points", type: "number" }),
    );
    const url = `/api/properties/${points.id}`;
    await ok(as.patch(url, { defaults: { [bug]: 3 } }));
    expect(await defaultsOf(points.id)).toEqual({ [bug]: 3 });
    await ok(as.patch(url, { defaults: { [bug]: 5 } }));
    expect(await defaultsOf(points.id)).toEqual({ [bug]: 5 });
    await ok(as.patch(url, { defaults: { [bug]: null } }));
    expect(await defaultsOf(points.id)).toBeUndefined();
  });
});
