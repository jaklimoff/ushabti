import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project } = await import("@/test/route");

type Prop = { id: string; name: string; type: string; config: { icon?: string | null } };
type Read = { properties: Prop[] };

async function setUp() {
  const owner = await person("Flag Owner");
  const p = await project(owner);
  const me = api(owner);
  await ok(me.post(`/api/projects/${p.id}/properties`, { name: "Blocked", type: "checkbox" }));
  const prop = async (name: string) =>
    ((await board(owner, p.id)) as Read).properties.find((x) => x.name === name)!;
  return { me, prop };
}

describe("A checkbox's icon", () => {
  it("a PATCH with a catalogue name stores it, and null takes it off", async () => {
    const { me, prop } = await setUp();
    const blocked = await prop("Blocked");

    expect((await me.patch(`/api/properties/${blocked.id}`, { icon: "Flag" })).status).toBe(200);
    expect((await prop("Blocked")).config.icon).toBe("Flag");

    expect((await me.patch(`/api/properties/${blocked.id}`, { icon: null })).status).toBe(200);
    expect((await prop("Blocked")).config.icon ?? null).toBeNull();
  });

  it("refuses an unknown icon name and writes nothing", async () => {
    const { me, prop } = await setUp();
    const blocked = await prop("Blocked");
    for (const icon of ["NotAnIcon", "flag", "", 7, ["Flag"]]) {
      const res = await me.patch(`/api/properties/${blocked.id}`, { icon, name: "Renamed" });
      expect(res.status).toBe(400);
    }
    const after = await prop("Blocked");
    expect(after.config.icon ?? null).toBeNull();
    expect(after.name).toBe("Blocked");
  });

  it("refuses an icon on a property that is not a checkbox", async () => {
    const { me, prop } = await setUp();
    const priority = await prop("Priority");
    const res = await me.patch(`/api/properties/${priority.id}`, { icon: "Flag" });
    expect(res.status).toBe(400);
    expect((await prop("Priority")).config.icon).toBeUndefined();
  });
});
