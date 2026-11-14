import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, board, ok, person, project, task } = await import("@/test/route");

/*
 * The route half of "Card settings: copy the look of another project". The
 * page and the press are in `e2e/card-look.spec.ts`.
 */

type Option = { id: string; name: string; color: string; icon: string | null };
type Property = {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  options: Option[];
};
type Row = { place: string; mode: string };
type Board = {
  properties: Property[];
  cardView: { rows: Record<string, Row> };
  views: { id: string; name: string; cardView: { rows: Record<string, Row> } | null }[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
};

async function setUp() {
  const owner = await person("Look Owner");
  const me = api(owner);
  const here = await project(owner, "Look Here");
  const there = await project(owner, "Look There");
  const read = async (id: string) => (await board(owner, id)) as Board;
  const prop = async (id: string, name: string) =>
    (await read(id)).properties.find((p) => p.name === name)!;

  /* Tier is in both, in another letter case there. Only here is not there. */
  await ok(
    me.post(`/api/projects/${here.id}/properties`, {
      name: "Tier",
      type: "select",
      options: ["Gold", "Tin"],
    }),
  );
  await ok(me.post(`/api/projects/${here.id}/properties`, { name: "Only here", type: "text" }));
  await ok(me.post(`/api/projects/${here.id}/properties`, { name: "Hot", type: "checkbox" }));
  await ok(
    me.post(`/api/projects/${there.id}/properties`, {
      name: "tier",
      type: "select",
      options: ["GOLD", "Lead"],
    }),
  );
  await ok(me.post(`/api/projects/${there.id}/properties`, { name: "Hot", type: "checkbox" }));

  const theirTier = await prop(there.id, "tier");
  const gold = theirTier.options.find((o) => o.name === "GOLD")!;
  await ok(me.patch(`/api/options/${gold.id}`, { color: "#123456", icon: "Star" }));
  const theirHot = await prop(there.id, "Hot");
  await ok(me.patch(`/api/properties/${theirHot.id}`, { icon: "Heart", color: "#654321" }));

  const theirView = (await read(there.id)).cardView;
  await ok(
    me.patch(`/api/projects/${there.id}/card-view`, {
      cardView: {
        rows: {
          ...theirView.rows,
          _key: { place: "off", mode: "text" },
          [theirTier.id]: { place: "body", mode: "text" },
        },
      },
    }),
  );

  const onlyHere = await prop(here.id, "Only here");
  const mine = (await read(here.id)).cardView;
  await ok(
    me.patch(`/api/projects/${here.id}/card-view`, {
      cardView: { rows: { ...mine.rows, [onlyHere.id]: { place: "footerR", mode: "boxed" } } },
    }),
  );

  return { owner, me, here, there, read, prop };
}

describe("Copy the look of another project", () => {
  it("counts every other project of the caller, in one answer", async () => {
    const { me, here, there } = await setUp();
    const { projects } = await ok<{
      projects: { id: string; name: string; count: Record<string, unknown> }[];
    }>(me.get(`/api/projects/${here.id}/look`));
    expect(projects.map((p) => p.id)).not.toContain(here.id);
    const line = projects.find((p) => p.id === there.id)!;
    expect(line.name).toBe("Look There");
    expect(line.count.unmatched).toContain("Only here");
    expect(line.count.matched).toBe(
      (line.count.total as number) - (line.count.unmatched as string[]).length,
    );
    /* Gold, and the checkbox. Tin has no match. Whatever the new project
       starts with is the same in both, so it counts on both sides. */
    expect(line.count.looks as number).toBeGreaterThanOrEqual(2);
  });

  it("writes the matched rows, icons and colours, and nothing else", async () => {
    const { owner, me, here, there, read, prop } = await setUp();
    const t = await task(owner, here.id, "Stays as it is");
    const firstView = (await read(here.id)).views[0];
    await ok(
      me.patch(`/api/views/${firstView.id}/card-view`, {
        cardView: (await read(here.id)).cardView,
      }),
    );
    const before = await read(here.id);

    const answer = await ok<{ cardView: { rows: Record<string, Row> } }>(
      me.post(`/api/projects/${here.id}/look`, { from: there.id, layout: true, looks: true }),
    );

    const after = await read(here.id);
    const tier = await prop(here.id, "Tier");
    const onlyHere = await prop(here.id, "Only here");
    const hot = await prop(here.id, "Hot");

    expect(after.cardView.rows._key.place).toBe("off");
    expect(after.cardView.rows[tier.id]).toEqual({ place: "body", mode: "text" });
    expect(answer.cardView.rows[tier.id]).toEqual({ place: "body", mode: "text" });
    /* No match there: it keeps the row it had. */
    expect(after.cardView.rows[onlyHere.id]).toEqual({ place: "footerR", mode: "boxed" });

    const gold = tier.options.find((o) => o.name === "Gold")!;
    const tin = tier.options.find((o) => o.name === "Tin")!;
    expect([gold.color, gold.icon]).toEqual(["#123456", "Star"]);
    const tinBefore = before.properties
      .find((p) => p.id === tier.id)!
      .options.find((o) => o.id === tin.id)!;
    expect(tin).toEqual(tinBefore);
    expect([hot.config.icon, hot.config.color]).toEqual(["Heart", "#654321"]);

    /* Nothing is made, removed, renamed or moved; no view's own card and no task changes. */
    const shape = (b: Board) =>
      b.properties.map((p) => [p.id, p.name, p.type, p.options.map((o) => [o.id, o.name])]);
    expect(shape(after)).toEqual(shape(before));
    expect(after.views.map((v) => [v.id, v.cardView])).toEqual(
      before.views.map((v) => [v.id, v.cardView]),
    );
    expect(after.tasks.find((x) => x.id === t.id)).toEqual(before.tasks.find((x) => x.id === t.id));

    /* The other project is only read. */
    expect((await prop(there.id, "tier")).name).toBe("tier");
  });

  it("copies one half when only one is ticked", async () => {
    const { me, here, there, read, prop } = await setUp();
    const before = (await read(here.id)).cardView;
    await ok(
      me.post(`/api/projects/${here.id}/look`, { from: there.id, layout: false, looks: true }),
    );
    expect((await read(here.id)).cardView).toEqual(before);
    const gold = (await prop(here.id, "Tier")).options.find((o) => o.name === "Gold")!;
    expect(gold.color).toBe("#123456");

    const answer = await me.post(`/api/projects/${here.id}/look`, {
      from: there.id,
      layout: false,
      looks: false,
    });
    expect(answer.status).toBe(400);
  });

  it("refuses an agent's token", async () => {
    const { owner, here, there } = await setUp();
    const bot = await agent(owner, here.id);
    expect((await bot.api.get(`/api/projects/${here.id}/look`)).status).toBe(403);
    const answer = await bot.api.post(`/api/projects/${here.id}/look`, {
      from: there.id,
      layout: true,
      looks: true,
    });
    expect(answer.status).toBe(403);
  });

  it("refuses a project the caller is not a member of, and says nothing about it", async () => {
    const { me, here, read } = await setUp();
    const stranger = await person("Somebody Else");
    const theirs = await project(stranger, "Secret Board");
    const before = await read(here.id);

    const answer = await me.post(`/api/projects/${here.id}/look`, {
      from: theirs.id,
      layout: true,
      looks: true,
    });
    expect(answer.status).toBe(404);
    expect(await answer.text()).not.toContain("Secret");
    expect((await read(here.id)).cardView).toEqual(before.cardView);

    const { projects } = await ok<{ projects: { id: string }[] }>(
      me.get(`/api/projects/${here.id}/look`),
    );
    expect(projects.map((p) => p.id)).not.toContain(theirs.id);

    /* And the stranger cannot copy into a project of ours either. */
    const back = await api(stranger).post(`/api/projects/${here.id}/look`, {
      from: theirs.id,
      layout: true,
      looks: true,
    });
    expect(back.status).toBe(404);
  });
});
