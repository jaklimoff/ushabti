import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, board, join, ok, person, project } = await import("@/test/route");

/*
 * The server's half of an option that carries a plan. Each test was a test of
 * `e2e/option-dates.spec.ts` and carries its name. What Settings draws of the
 * boxes, and what they send, is in `OptionDates.test.tsx`.
 */

type Option = {
  id: string;
  name: string;
  startAt: string | null;
  targetAt: string | null;
  shippedAt: string | null;
  note: string | null;
};
type Property = {
  id: string;
  name: string;
  type: string;
  config?: { dated?: boolean };
  options: Option[];
};

async function setUp() {
  const owner = await person("Plan Owner");
  const p = await project(owner);
  const me = api(owner);
  const read = async () => (await board(owner, p.id)).properties as Property[];
  const property = async (name: string) => (await read()).find((x) => x.name === name)!;
  const option = async (prop: string, name: string) =>
    (await property(prop)).options.find((o) => o.name === name)!;
  return { owner, project: p, me, property, option };
}

describe("An option carries a plan", () => {
  it("the option routes take the four, and the board answer carries them", async () => {
    const { project: p, me, property, option } = await setUp();
    const status = await property("Status");
    const options = `/api/properties/${status.id}/options`;

    const made = await me.post(options, {
      name: "Sprint 4",
      startAt: "2026-10-01",
      targetAt: "2026-10-14",
      note: "**API**",
    });
    expect(made.status).toBe(201);
    let sprint = await option("Status", "Sprint 4");
    expect(sprint).toMatchObject({
      startAt: "2026-10-01",
      targetAt: "2026-10-14",
      shippedAt: null,
      note: "**API**",
    });

    // An option made without them carries them as null.
    expect(await option("Status", "Todo")).toMatchObject({
      startAt: null,
      targetAt: null,
      shippedAt: null,
      note: null,
    });

    const bad = await me.patch(`/api/options/${sprint.id}`, { targetAt: "soon" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("The target date must be a date like 2026-10-03.");

    // A target moved alone is read against the start already saved.
    const early = await me.patch(`/api/options/${sprint.id}`, { targetAt: "2026-09-30" });
    expect(early.status).toBe(400);
    expect((await early.json()).error).toBe("The target date cannot be before the start date.");

    const backwards = await me.post(options, {
      name: "Sprint 5",
      startAt: "2026-10-15",
      targetAt: "2026-10-01",
    });
    expect(backwards.status).toBe(400);

    const shipped = await me.patch(`/api/options/${sprint.id}`, {
      shippedAt: "2026-10-13",
      note: null,
    });
    expect(shipped.status).toBe(200);
    sprint = await option("Status", "Sprint 4");
    expect(sprint).toMatchObject({ targetAt: "2026-10-14", shippedAt: "2026-10-13", note: null });

    // The property route and the export send the same option.
    const prop = await ok<{ property: Property }>(
      me.post(`/api/projects/${p.id}/properties`, {
        name: "Quarter",
        type: "select",
        options: ["Q4"],
      }),
    );
    expect(prop.property.options[0]).toMatchObject({ name: "Q4", startAt: null, note: null });
    const exported = await ok(me.get(`/api/projects/${p.id}/export`));
    expect(JSON.stringify(exported)).toContain('"shippedAt":"2026-10-13"');
  });

  it("a multi-select option does not get them", async () => {
    const { me, property } = await setUp();
    const status = await property("Status");
    await ok(me.patch(`/api/properties/${status.id}`, { dated: true }));
    const labels = await property("Labels");
    expect(labels.type).toBe("multi_select");

    const made = await me.post(`/api/properties/${labels.id}/options`, {
      name: "urgent",
      targetAt: "2026-10-14",
    });
    expect(made.status).toBe(400);
    expect((await made.json()).error).toBe(
      "Only an option of a single select carries dates and a note.",
    );

    const patched = await me.patch(`/api/options/${labels.options[0].id}`, { note: "no" });
    expect(patched.status).toBe(400);
  });

  it("only an admin, and only a person, writes the shipped date", async () => {
    const { owner, project: p, me, property, option } = await setUp();
    const adminP = await person("Ada Admin");
    const memberP = await person("Bob Member");
    await join(p.id, adminP, "admin");
    await join(p.id, memberP, "member");
    const helper = await agent(owner, p.id, "Helper");
    const status = await property("Status");
    await ok(me.patch(`/api/properties/${status.id}`, { dated: true }));
    const admin = api(adminP);
    const member = api(memberP);
    const ready = await option("Status", "Ready");
    const url = `/api/options/${ready.id}`;
    const shippedOf = async (name: string) => (await option("Status", name)).shippedAt;

    // A member and a token are refused, with a sentence, and nothing is written.
    const byMember = await member.patch(url, { shippedAt: "2026-10-02" });
    expect(byMember.status).toBe(403);
    expect((await byMember.json()).error).toMatch(/owner or an admin/);
    const byAgent = await helper.api.patch(url, { shippedAt: "2026-10-02" });
    expect(byAgent.status).toBe(403);
    expect((await byAgent.json()).error).toMatch(/\.$/);
    expect(await shippedOf("Ready")).toBeNull();

    // The owner and an admin ship, and Unship is null.
    await ok(me.patch(url, { shippedAt: "2026-10-02" }));
    expect(await shippedOf("Ready")).toBe("2026-10-02");
    expect((await member.patch(url, { shippedAt: null })).status).toBe(403);
    expect((await helper.api.patch(url, { shippedAt: null })).status).toBe(403);
    expect(await shippedOf("Ready")).toBe("2026-10-02");
    await ok(admin.patch(url, { shippedAt: null }));
    expect(await shippedOf("Ready")).toBeNull();
    await ok(admin.patch(url, { shippedAt: "2026-10-03" }));
    expect(await shippedOf("Ready")).toBe("2026-10-03");

    // Without the shipped date, a member and a token write the rest as before.
    await ok(member.patch(url, { targetAt: "2026-10-20", note: "Soon" }));
    await ok(helper.api.patch(url, { startAt: "2026-10-01", color: "#3fb0c8" }));
    await ok(admin.patch(url, { name: "Ready to go" }));
    expect(await option("Status", "Ready to go")).toMatchObject({
      startAt: "2026-10-01",
      targetAt: "2026-10-20",
      shippedAt: "2026-10-03",
      note: "Soon",
    });

    // An option born shipped is a ship too, on the route that adds one.
    const add = `/api/properties/${status.id}/options`;
    const born = { name: "Born shipped", shippedAt: "2026-10-01" };
    expect((await member.post(add, born)).status).toBe(403);
    expect((await helper.api.post(add, born)).status).toBe(403);
    await ok(member.post(add, { name: "Plain" }));
    await ok(me.post(add, born));
    expect(await shippedOf("Born shipped")).toBe("2026-10-01");
  });

  it("only an admin, and only a person, turns it", async () => {
    const { owner, project: p, me, property } = await setUp();
    const memberP = await person("Bob Member");
    await join(p.id, memberP, "member");
    const helper = await agent(owner, p.id, "Helper");
    const status = await property("Status");
    const url = `/api/properties/${status.id}`;
    const dated = async () => (await property("Status")).config?.dated;

    expect((await helper.api.patch(url, { dated: true })).status).toBe(403);
    const byMember = await api(memberP).patch(url, { dated: true });
    expect(byMember.status).toBe(403);
    expect((await byMember.json()).error).toMatch(/owner or an admin/);
    expect(await dated()).toBeUndefined();

    const labels = await property("Labels");
    expect((await me.patch(`/api/properties/${labels.id}`, { dated: true })).status).toBe(400);
    expect((await me.patch(url, { dated: "yes" })).status).toBe(400);

    await ok(me.patch(url, { dated: true }));
    expect(await dated()).toBe(true);
    // A token still reads it, as it reads the rest of a property.
    const read = await ok<{ properties: Property[] }>(
      helper.api.get(`/api/projects/${p.id}/board`),
    );
    expect(read.properties.find((x) => x.id === status.id)).toMatchObject({
      config: { dated: true },
    });
    // A rename leaves the switch where it was.
    await ok(me.patch(url, { name: "State" }));
    expect((await property("State")).config?.dated).toBe(true);
  });
});
