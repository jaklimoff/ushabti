import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, person, project } = await import("@/test/route");
const { db } = await import("@/db");
const { propertyOptions } = await import("@/db/schema");
const { OPTION_ICONS } = await import("@/lib/option-icons");

type Option = { id: string; name: string; icon: string | null };
type Read = { properties: { id: string; name: string; options: Option[] }[] };

async function setUp() {
  const owner = await person("Icon Owner");
  const p = await project(owner);
  const me = api(owner);
  const prop = async (name: string) =>
    ((await board(owner, p.id)) as Read).properties.find((x) => x.name === name)!;
  return { project: p, me, prop };
}

describe("An option's icon", () => {
  it("a new project's Status and Priority options carry the seeded icons", async () => {
    const { prop } = await setUp();
    const icons = (opts: Option[]) => Object.fromEntries(opts.map((o) => [o.name, o.icon]));
    expect(icons((await prop("Status")).options)).toEqual({
      Later: "CirclePause",
      Backlog: "CircleDashed",
      Todo: "Circle",
      "In Progress": "CircleDot",
      Ready: "Rocket",
      Done: "CheckCircle",
    });
    expect(icons((await prop("Priority")).options)).toEqual({
      Urgent: "OctagonAlert",
      High: "SignalHigh",
      Medium: "SignalMedium",
      Low: "SignalLow",
    });
  });

  it("a PATCH with a catalogue name stores it, and null takes it off", async () => {
    const { me, prop } = await setUp();
    const todo = (await prop("Status")).options.find((o) => o.name === "Todo")!;

    expect((await me.patch(`/api/options/${todo.id}`, { icon: "Bug" })).status).toBe(200);
    expect((await prop("Status")).options.find((o) => o.id === todo.id)!.icon).toBe("Bug");

    expect((await me.patch(`/api/options/${todo.id}`, { icon: null })).status).toBe(200);
    expect((await prop("Status")).options.find((o) => o.id === todo.id)!.icon).toBeNull();
  });

  it("a PATCH with an unknown name or a non-string answers 400 and writes nothing", async () => {
    const { me, prop } = await setUp();
    const todo = (await prop("Status")).options.find((o) => o.name === "Todo")!;

    for (const icon of ["NotAnIcon", "circle", "", 7, true, ["Bug"], { name: "Bug" }]) {
      const res = await me.patch(`/api/options/${todo.id}`, { icon, name: "Renamed" });
      expect(res.status).toBe(400);
    }
    const after = (await prop("Status")).options.find((o) => o.id === todo.id)!;
    expect(after.icon).toBe("Circle");
    expect(after.name).toBe("Todo");
  });

  it("a POST takes an icon, and refuses a name not in the list", async () => {
    const { me, prop } = await setUp();
    const status = await prop("Status");
    const url = `/api/properties/${status.id}/options`;

    expect((await me.post(url, { name: "Blocked", icon: "Ban" })).status).toBe(201);
    expect((await me.post(url, { name: "Bare" })).status).toBe(201);
    expect((await me.post(url, { name: "Odd", icon: "Skull" })).status).toBe(400);

    const opts = (await prop("Status")).options;
    expect(opts.find((o) => o.name === "Blocked")!.icon).toBe("Ban");
    expect(opts.find((o) => o.name === "Bare")!.icon).toBeNull();
    expect(opts.map((o) => o.name)).not.toContain("Odd");
  });

  it("an option whose stored icon left the catalogue reads icon null, and keeps the row", async () => {
    const { prop } = await setUp();
    const todo = (await prop("Status")).options.find((o) => o.name === "Todo")!;
    await db
      .update(propertyOptions)
      .set({ icon: "Retired" })
      .where(eq(propertyOptions.id, todo.id));

    expect((await prop("Status")).options.find((o) => o.id === todo.id)!.icon).toBeNull();
    expect((await prop("Status")).options.find((o) => o.id === todo.id)!.icon).toBeNull();
    const [row] = await db
      .select({ icon: propertyOptions.icon })
      .from(propertyOptions)
      .where(eq(propertyOptions.id, todo.id));
    expect(row.icon).toBe("Retired");
  });

  it("the export carries each option's icon", async () => {
    const { me, project: p, prop } = await setUp();
    const status = await prop("Status");
    const file = (await (await me.get(`/api/projects/${p.id}/export`)).json()) as Read;
    const exported = file.properties.find((x) => x.name === "Status")!;
    expect(exported.options.map((o) => [o.name, o.icon])).toEqual(
      status.options.map((o) => [o.name, o.icon]),
    );
  });
});

describe("The icon list", () => {
  it("holds unique names of at most 16 characters", () => {
    expect(new Set(OPTION_ICONS).size).toBe(OPTION_ICONS.length);
    for (const name of OPTION_ICONS) expect(name.length).toBeLessThanOrEqual(16);
  });
});
