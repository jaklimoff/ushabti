import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, agent, board, join, ok, person, project } = await import("@/test/route");

/*
 * The server's half of "a property says when it shows". Each test was a test
 * of `e2e/when.spec.ts`, and carries its name. What Settings and the board
 * draw of a rule is in `When.test.tsx`. The race of two rules stayed end to
 * end: one in-memory database answers one request at a time, so it could not
 * lose the race the project lock is there for.
 */

type Option = { id: string; name: string };
type Property = {
  id: string;
  name: string;
  options: Option[];
  config: { when?: { propertyId: string; optionIds: string[] }; dated?: boolean };
};

/** A project with a Type select of Bug and Story. */
async function typed(name: string) {
  const owner = await person(name);
  const p = await project(owner);
  await ok(
    api(owner).post(`/api/projects/${p.id}/properties`, {
      name: "Type",
      type: "select",
      options: ["Bug", "Story"],
    }),
  );
  const read = async (who = owner) => (await board(who, p.id)).properties as Property[];
  const of = async (n: string) => (await read()).find((x) => x.name === n)!;
  const type = await of("Type");
  const option = (n: string) => type.options.find((o) => o.name === n)!.id;
  return { owner, p, read, of, type, bug: option("Bug"), story: option("Story") };
}

describe("A property says when it shows", () => {
  it("only an admin, and only a person, sets it, and a value it cannot read is a 400", async () => {
    const { owner, p, read, of, type, bug, story } = await typed("When rights");
    const member = await person("Bob Member");
    await join(p.id, member, "member");
    const helper = await agent(owner, p.id, "Helper");
    const as = api(owner);

    const priority = await of("Priority");
    const url = `/api/properties/${priority.id}`;
    const rule = { propertyId: type.id, optionIds: [bug] };
    const when = async () => (await read()).find((x) => x.id === priority.id)?.config.when;

    expect((await helper.api.patch(url, { when: rule })).status).toBe(403);
    const byMember = await api(member).patch(url, { when: rule });
    expect(byMember.status).toBe(403);
    expect((await byMember.json()).error).toMatch(/owner or an admin/);
    expect(await when()).toBeUndefined();

    const labels = await of("Labels");
    for (const bad of [
      "Bug",
      { propertyId: type.id },
      { propertyId: type.id, optionIds: [] },
      { propertyId: type.id, optionIds: ["not-an-option"] },
      { propertyId: priority.id, optionIds: [priority.options[0].id] },
      { propertyId: labels.id, optionIds: [labels.options[0]?.id ?? "x"] },
      { propertyId: "00000000-0000-4000-8000-000000000000", optionIds: [bug] },
    ]) {
      expect((await as.patch(url, { when: bad })).status).toBe(400);
    }
    expect(await when()).toBeUndefined();

    await ok(as.patch(url, { when: rule }));
    expect(await when()).toEqual(rule);
    // A token reads the rule as the board reads it.
    const seen = (await read(helper.caller)).find((x) => x.id === priority.id);
    expect(seen?.config.when).toEqual(rule);

    // Type shown when Priority is Urgent would close a circle with the rule
    // above, and a task with neither value could set neither.
    const urgent = priority.options.find((o) => o.name === "Urgent")!.id;
    const circle = await as.patch(`/api/properties/${type.id}`, {
      when: { propertyId: priority.id, optionIds: [urgent] },
    });
    expect(circle.status).toBe(400);
    expect((await circle.json()).error).toMatch(/circle/);

    // Two parts of the config in one request keep both.
    const status = await of("Status");
    const both = { propertyId: type.id, optionIds: [story] };
    await ok(as.patch(`/api/properties/${status.id}`, { dated: true, when: both }));
    expect((await of("Status")).config).toMatchObject({ dated: true, when: both });

    // Delete Bug and the rule reads as always shown, with nothing cleaned.
    await ok(as.del(`/api/options/${bug}`));
    expect(await when()).toBeUndefined();

    await ok(as.patch(url, { when: null }));
    expect(await when()).toBeUndefined();
  });

  it("keeps the rule it was sent, and takes it away again", async () => {
    // The kept half of "Settings says the rule in words and clears it with
    // one press", which read it back after a reload.
    const { owner, read, of, type, bug, story } = await typed("When kept");
    const priority = await of("Priority");
    const as = api(owner);

    await ok(
      as.patch(`/api/properties/${priority.id}`, {
        when: { propertyId: type.id, optionIds: [bug] },
      }),
    );
    await ok(
      as.patch(`/api/properties/${priority.id}`, {
        when: { propertyId: type.id, optionIds: [bug, story] },
      }),
    );
    expect((await read()).find((x) => x.id === priority.id)?.config).toMatchObject({
      when: { propertyId: type.id, optionIds: [bug, story] },
    });

    await ok(as.patch(`/api/properties/${priority.id}`, { when: null }));
    expect((await read()).find((x) => x.id === priority.id)?.config.when).toBeUndefined();
  });
});
