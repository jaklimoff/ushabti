import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project } = await import("@/test/route");

/*
 * The server's half of One name, one option. Each test was a test of
 * `e2e/option-names.spec.ts` and carries its name. The race of four creates at
 * once stayed end to end, because it needs the real database. What the menu
 * and the box draw of these answers is in `OptionNames.test.tsx`.
 */

type Read = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
};

async function setUp() {
  const owner = await person("Names Owner");
  const p = await project(owner);
  const me = api(owner);
  const read = async () => (await board(owner, p.id)) as Read;
  const status = async () => (await read()).properties.find((x) => x.name === "Status")!;
  return { owner, project: p, me, read, status };
}

describe("One name, one option", () => {
  it("a second option or a rename to a name that is taken answers 409", async () => {
    const { me, status } = await setUp();
    const first = await status();
    const options = `/api/properties/${first.id}/options`;

    expect((await me.post(options, { name: "Blocked" })).status).toBe(201);

    const again = await me.post(options, { name: "  blocked " });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("Status already has an option named Blocked.");

    const todo = first.options.find((o) => o.name === "Todo")!;
    const renamed = await me.patch(`/api/options/${todo.id}`, { name: "BLOCKED" });
    expect(renamed.status).toBe(409);
    expect((await renamed.json()).error).toBe("Status already has an option named Blocked.");

    // An option may change the case of its own name.
    const blocked = (await status()).options.find((o) => o.name === "Blocked")!;
    expect((await me.patch(`/api/options/${blocked.id}`, { name: "blocked" })).status).toBe(200);

    const names = (await status()).options.map((o) => o.name.toLowerCase());
    expect(names.filter((n) => n === "blocked")).toHaveLength(1);
    expect(names).toContain("todo");
  });

  it("a new property refuses two options with one name, and makes nothing", async () => {
    const { me, project: p, read } = await setUp();
    const made = await me.post(`/api/projects/${p.id}/properties`, {
      name: "Stage",
      type: "select",
      options: ["Draft", "Live", " draft "],
    });
    expect(made.status).toBe(400);
    expect((await made.json()).error).toBe("Stage already has an option named Draft.");

    expect((await read()).properties.map((x) => x.name)).not.toContain("Stage");
  });

  it("a new property with more than 40 options is refused whole", async () => {
    const { me, project: p, read } = await setUp();
    const sixty = Array.from({ length: 60 }, (_, i) => `Label ${i + 1}`);
    const made = await me.post(`/api/projects/${p.id}/properties`, {
      name: "Stickers",
      type: "multi_select",
      options: sixty,
    });
    expect(made.status).toBe(400);
    expect((await made.json()).error).toBe(
      "A property holds at most 40 options. This list has 60.",
    );

    // Neither the property nor any of its options was kept.
    const after = await read();
    expect(after.properties.map((x) => x.name)).not.toContain("Stickers");
    const labels = after.properties.flatMap((x) => x.options).filter((o) => /^Label /.test(o.name));
    expect(labels).toHaveLength(0);

    // Forty is the limit, and forty is kept.
    const forty = await ok<unknown>(
      me.post(`/api/projects/${p.id}/properties`, {
        name: "Stickers",
        type: "multi_select",
        options: sixty.slice(0, 40),
      }),
    );
    expect(forty).toBeTruthy();
  });
});
