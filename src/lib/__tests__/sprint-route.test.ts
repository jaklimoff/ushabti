import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, board, join, ok, person, project } = await import("@/test/route");

/*
 * The server's half of sprints: the two switches, the cadence, Close and an
 * ended sprint. One file, because each file of route tests pays for its own
 * database. Each test was a test of the end to end spec its block names, and
 * carries its name or says which half it is. Shipping the last sprint through
 * the column, the walk from grouping to the roadmap and the two migrations
 * stay end to end.
 */

type Option = {
  id: string;
  name: string;
  startAt: string | null;
  targetAt: string | null;
  shippedAt: string | null;
};
type Board = {
  project: { releaseBy: string | null; sprintBy: string | null };
  properties: {
    id: string;
    name: string;
    type: string;
    config: { cadence?: { length?: number }; dated?: boolean };
    options: Option[];
  }[];
  views: {
    id: string;
    name: string;
    kind: string;
    groupById: string | null;
    isDefault: boolean;
    filters: { rules: { propertyId: string; op: string; values?: string[] }[] };
  }[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
  archived: { id: string; title: string }[];
};

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

const dates = (o: Option) => [o.name, o.startAt, o.targetAt];

async function owned(name = "Olga Owner") {
  const owner = await person(name);
  const p = await project(owner);
  const me = api(owner);
  const read = async () => (await board(owner, p.id)) as Board;
  const sprintOf = async () => (await read()).properties.find((x) => x.name === "Sprint")!;
  return { owner, projectId: p.id, me, read, sprintOf };
}

/* ---- e2e/cadence.spec.ts ------------------------------------------------ */

describe("A cadence", () => {
  /* The server half of "Use sprints asks for the length and the first day,
     and makes two sprints". The switch sending the two answers is
     `settings/Sprints.test.tsx`. */
  it("Use sprints asks for the length and the first day, and makes two sprints", async () => {
    const { owner, projectId, me, sprintOf } = await owned();
    const made = await me.post(`/api/projects/${projectId}/sprints`, {
      length: 7,
      startAt: "2036-11-02",
    });
    expect(made.status).toBe(201);
    const sprint = await sprintOf();
    expect(sprint.config.cadence).toEqual({ length: 7 });
    expect(sprint.options.map(dates)).toEqual([
      ["Sprint 1", "2036-11-02", "2036-11-08"],
      ["Sprint 2", "2036-11-09", "2036-11-15"],
    ]);

    /* With nothing asked, the route takes 14 days from the project's today. */
    const other = await project(owner);
    expect((await me.post(`/api/projects/${other.id}/sprints`)).status).toBe(201);
    const plain = ((await board(owner, other.id)) as Board).properties.find(
      (x) => x.name === "Sprint",
    )!;
    expect(plain.options[0].startAt).toBe(day(0));
    expect(plain.options).toHaveLength(2);

    /* A length that cannot be one is refused, and nothing is made. */
    const third = await project(owner);
    const bad = await me.post(`/api/projects/${third.id}/sprints`, { length: 0 });
    expect(bad.status).toBe(400);
    expect(((await board(owner, third.id)) as Board).properties.map((x) => x.name)).not.toContain(
      "Sprint",
    );
  });

  it("the cadence fills in after what an admin did by hand", async () => {
    const { projectId, me, sprintOf } = await owned();
    await ok(me.post(`/api/projects/${projectId}/sprints`, { length: 14, startAt: "2036-10-05" }));
    const [first, second] = (await sprintOf()).options;

    await ok(me.del(`/api/options/${second.id}`));
    await ok(me.patch(`/api/options/${first.id}`, { name: "Kickoff", targetAt: "2036-10-10" }));
    await ok(me.post(`/api/options/${first.id}/ship`, { rest: "leave" }));

    expect((await sprintOf()).options.map(dates)).toEqual([
      ["Kickoff", "2036-10-05", "2036-10-10"],
      ["Kickoff 2", "2036-10-11", "2036-10-24"],
    ]);
  });

  /* The route half of "Settings shows the cadence, saved on blur and on
     leave": what the box saves is kept, and a member is refused. The box is
     `settings/Sprints.test.tsx`. */
  it("a cadence saved is kept; a member writes values, never the cadence", async () => {
    const { projectId, me, sprintOf } = await owned();
    await ok(me.post(`/api/projects/${projectId}/sprints`, { length: 14, startAt: "2036-10-05" }));
    const sprint = await sprintOf();

    await ok(me.patch(`/api/properties/${sprint.id}`, { cadence: { length: 7 } }));
    expect((await sprintOf()).config.cadence).toEqual({ length: 7 });

    const bob = await person("Bob Member");
    await join(projectId, bob, "member");
    const refused = await api(bob).patch(`/api/properties/${sprint.id}`, {
      cadence: { length: 3 },
    });
    expect(refused.status).toBe(403);
    expect((await sprintOf()).config.cadence).toEqual({ length: 7 });
  });
});

/* ---- e2e/close-sprint.spec.ts ------------------------------------------- */

describe("Closing a sprint", () => {
  /* The words of the question and of the toast are `ship.test.ts`. */
  it("closing a sprint archives nothing, and only a release reaches the changelog", async () => {
    const { projectId, me, read } = await owned();
    expect((await me.post(`/api/projects/${projectId}/sprints`, { length: 14 })).status).toBe(201);
    await ok(
      me.post(`/api/projects/${projectId}/properties`, {
        name: "Version",
        type: "select",
        options: ["v1", "v2"],
      }),
    );
    let b = await read();
    const sprint = b.properties.find((x) => x.name === "Sprint")!;
    const version = b.properties.find((x) => x.name === "Version")!;
    const status = b.properties.find((x) => x.name === "Status")!;
    const done = status.options.find((o) => o.name === "Done")!;
    const backlog = status.options.find((o) => o.name === "Backlog")!;
    const [s1, s2] = sprint.options;
    const [v1, v2] = version.options;
    await ok(me.patch(`/api/properties/${version.id}`, { dated: true }));
    // The changelog is there only while releases are on, and Version is the releases.
    await ok(me.post(`/api/projects/${projectId}/releases`));
    await ok(me.patch(`/api/options/${v1.id}`, { targetAt: "2026-10-14" }));
    await ok(
      me.patch(`/api/projects/${projectId}`, {
        doneWhen: { propertyId: status.id, optionId: done.id },
      }),
    );
    const task = (title: string, values: Record<string, unknown>) =>
      ok(me.post(`/api/projects/${projectId}/tasks`, { title, values }));
    await task("Released", { [sprint.id]: s1.id, [version.id]: v1.id, [status.id]: done.id });
    await task("Waits for v2", { [sprint.id]: s1.id, [version.id]: v2.id, [status.id]: done.id });
    await task("Not done", { [sprint.id]: s1.id, [status.id]: backlog.id });
    await task("Stays put", { [sprint.id]: s2.id, [status.id]: backlog.id });
    const valueOf = (title: string) => b.tasks.find((t) => t.title === title)!.values[sprint.id];

    /* Close moves the unfinished task on and keeps the finished ones. */
    const closed = await ok(me.post(`/api/options/${s1.id}/ship`, { rest: "next" }));
    expect(closed).toMatchObject({ archived: 0, moved: 1, rest: "next" });
    b = await read();
    expect(b.archived).toEqual([]);
    expect(valueOf("Released")).toBe(s1.id);
    expect(valueOf("Waits for v2")).toBe(s1.id);
    expect(valueOf("Not done")).toBe(s2.id);

    /* Leave keeps the rest where it is, and still archives nothing. */
    const left = await ok(me.post(`/api/options/${s2.id}/ship`, { rest: "leave" }));
    expect(left).toMatchObject({ archived: 0, moved: 0, rest: "leave" });
    b = await read();
    expect(b.archived).toEqual([]);
    expect(valueOf("Stays put")).toBe(s2.id);
    expect(valueOf("Not done")).toBe(s2.id);

    /* Shipping the release archives what is over in it, as before. */
    const shipped = await ok(me.post(`/api/options/${v1.id}/ship`, { rest: "leave" }));
    expect(shipped).toMatchObject({ archived: 1 });
    b = await read();
    expect(b.archived.map((t) => t.title)).toEqual(["Released"]);

    /* The changelog lists the release and neither sprint. */
    const { changelog } = await ok<{ changelog: { name: string }[] }>(
      me.get(`/api/projects/${projectId}/changelog`),
    );
    expect(changelog.map((e) => e.name)).toEqual(["v1"]);

    /* A task in a closed sprint and an open release is still on the board. */
    expect(b.tasks.find((t) => t.title === "Waits for v2")!.values[version.id]).toBe(v2.id);
  });
});

/* ---- e2e/ended-sprint.spec.ts ------------------------------------------- */

/** Sprints, with Sprint 1 a week past its end and Alpha in it. */
async function ended() {
  const made = await owned();
  const { projectId, me, sprintOf } = made;
  expect((await me.post(`/api/projects/${projectId}/sprints`, { length: 14 })).status).toBe(201);
  const [first, second] = (await sprintOf()).options;
  await ok(me.patch(`/api/options/${first.id}`, { startAt: day(-20), targetAt: day(-7) }));
  await ok(me.patch(`/api/options/${second.id}`, { startAt: day(-6), targetAt: day(7) }));
  await ok(
    me.post(`/api/projects/${projectId}/tasks`, {
      title: "Alpha",
      values: { [(await sprintOf()).id]: first.id },
    }),
  );
  return { ...made, sprint: await sprintOf(), first, second };
}

describe("A sprint past its end", () => {
  it("a sprint past its end stays open, and the board read writes nothing", async () => {
    const { projectId, me, read, sprint, first } = await ended();
    const cursor = (await ok<{ now: string }>(me.get(`/api/projects/${projectId}/activity`))).now;

    const before = await read();
    const again = await read();
    expect(again.properties).toEqual(before.properties);
    const options = again.properties.find((x) => x.id === sprint.id)!.options;
    expect(options.find((o) => o.id === first.id)!.shippedAt).toBeNull();
    expect(again.tasks.find((t) => t.title === "Alpha")!.values[sprint.id]).toBe(first.id);
    expect(again.archived).toEqual([]);

    /* Nothing was written while the board was read: the feed is empty after it. */
    const feed = await ok<{ entries: unknown[] }>(
      me.get(`/api/projects/${projectId}/activity?after=${encodeURIComponent(cursor)}`),
    );
    expect(feed.entries).toEqual([]);
  });

  /* The route half of "the header says how long ago it ended, and Close makes
     the next sprint". The header is `board/Sprints.test.tsx`. */
  it("Close makes the next sprint from today when none follows", async () => {
    const { me, read, sprint, first, second } = await ended();
    /* With the next sprint gone, Sprint 1 has no open sprint after it. */
    await ok(me.del(`/api/options/${second.id}`));

    await ok(me.post(`/api/options/${first.id}/ship`, { rest: "next" }));

    /* The old end was a week ago, so the new sprint starts today and lasts the length. */
    const b = await read();
    const made = b.properties.find((x) => x.id === sprint.id)!.options;
    expect(made.map((o) => [o.name, o.startAt, o.targetAt, o.shippedAt])).toEqual([
      ["Sprint 1", day(-20), day(-7), day(0)],
      ["Sprint 2", day(0), day(13), null],
    ]);
    expect(b.tasks.find((t) => t.title === "Alpha")!.values[sprint.id]).toBe(made[1].id);
    expect(first.id).toBe(made[0].id);
  });

  /* The route half of "Unship reopens an ended sprint, and nothing closes it
     again". The header it draws then is `board/Sprints.test.tsx`. */
  it("Unship reopens an ended sprint, and nothing closes it again", async () => {
    const { me, read, sprint, first } = await ended();
    const shippedAt = async () =>
      (await read()).properties
        .find((x) => x.id === sprint.id)!
        .options.find((o) => o.id === first.id)!.shippedAt;

    await ok(me.post(`/api/options/${first.id}/ship`, { rest: "leave" }));
    expect(await shippedAt()).not.toBeNull();

    await ok(me.patch(`/api/options/${first.id}`, { shippedAt: null }));
    expect(await shippedAt()).toBeNull();
    expect(await shippedAt()).toBeNull();
  });
});

/* ---- e2e/sprints.spec.ts ------------------------------------------------ */

describe("The two switches", () => {
  /* The route half of "an admin turns sprints on in one press; a member and
     an agent are refused". The switch and its question are
     `settings/Sprints.test.tsx`; the words of the question `plan-switch.test.ts`. */
  it("an admin turns sprints on in one press; a member and an agent are refused", async () => {
    const { owner, projectId, me, read } = await owned();
    const bob = await person("Bob Member");
    await join(projectId, bob, "member");
    const helper = await agent(owner, projectId, "Helper");

    /* ---- the door is shut to a member and to an agent ----------------- */

    const url = `/api/projects/${projectId}/sprints`;
    expect((await api(bob).post(url)).status).toBe(403);
    expect((await api(bob).del(url)).status).toBe(403);
    expect((await helper.api.post(url)).status).toBe(403);
    expect((await helper.api.del(url)).status).toBe(403);
    expect((await read()).properties.map((x) => x.name)).not.toContain("Sprint");

    /* ---- one press makes all of it ------------------------------------ */

    const before = await read();
    const main = before.views.find((v) => v.isDefault)!;
    expect((await me.post(url)).status).toBe(201);
    const after = await read();
    const sprint = after.properties.find((x) => x.name === "Sprint")!;
    /* A sprint is an iteration, whose options always carry dates. */
    expect(sprint).toMatchObject({ type: "iteration" });
    expect(after.project.sprintBy).toBe(sprint.id);
    /* On makes the first sprint and the one after it. */
    expect(sprint.options).toHaveLength(2);
    const added = after.views.filter((v) => !before.views.some((x) => x.id === v.id));
    expect(added.map((v) => [v.name, v.kind])).toEqual([
      ["Sprint", "board"],
      ["Backlog", "list"],
    ]);
    const [sprintBoard, backlog] = added;
    expect(sprintBoard.groupById).toBe(main.groupById);
    expect(sprintBoard.filters.rules).toEqual([
      { propertyId: sprint.id, op: "is", values: ["__current__"] },
    ]);
    expect(backlog.filters.rules).toEqual([
      { propertyId: sprint.id, op: "is", values: ["__none__"] },
    ]);
    expect(added.every((v) => !v.isDefault)).toBe(true);

    /* ---- on while on makes nothing twice ------------------------------- */

    expect((await me.post(url)).status).toBe(200);
    const again = await read();
    expect(again.properties.filter((x) => x.type === "iteration")).toHaveLength(1);
    expect(again.views).toHaveLength(after.views.length);

    /* ---- off keeps everything ------------------------------------------ */

    const optionId = sprint.options[0].id;
    await ok(
      me.post(`/api/projects/${projectId}/tasks`, {
        title: "Alpha",
        values: { [sprint.id]: optionId },
      }),
    );
    expect((await me.del(url)).status).toBe(200);
    const kept = await read();
    expect(kept.project.sprintBy).toBeNull();
    expect(kept.properties.find((x) => x.id === sprint.id)?.options).toHaveLength(2);
    expect(kept.views.map((v) => v.id).sort()).toEqual(after.views.map((v) => v.id).sort());
    expect(kept.tasks.find((t) => t.title === "Alpha")?.values[sprint.id]).toBe(optionId);

    /* ---- on again takes what is there ---------------------------------- */

    expect((await me.post(url)).status).toBe(200);
    const back = await read();
    expect(back.project.sprintBy).toBe(sprint.id);
    expect(back.properties.filter((x) => x.type === "iteration")).toHaveLength(1);
    expect(back.views).toHaveLength(after.views.length);

    /* ---- what it made is ordinary, and a name is not the switch -------- */

    await ok(me.patch(`/api/properties/${sprint.id}`, { name: "Cycle" }));
    expect((await read()).project.sprintBy).toBe(sprint.id);
    await ok(me.del(`/api/properties/${sprint.id}`));
    /* A plain select named Sprint is just a select. */
    await ok(me.post(`/api/projects/${projectId}/properties`, { name: "Sprint", type: "select" }));
    expect((await read()).project.sprintBy).toBeNull();
  });

  /* The route half of "an admin turns releases on: a dated Release with no
     options and a Roadmap on it". The switch is `settings/Sprints.test.tsx`. */
  it("an admin turns releases on: a dated Release with no options and a Roadmap on it", async () => {
    const { projectId, me, read } = await owned();
    const before = await read();
    const url = `/api/projects/${projectId}/releases`;

    expect((await me.post(url)).status).toBe(201);
    const after = await read();
    const release = after.properties.find((x) => x.name === "Release")!;
    expect(release).toMatchObject({ type: "select", config: { dated: true }, options: [] });
    expect(after.project.releaseBy).toBe(release.id);
    const added = after.views.filter((v) => !before.views.some((x) => x.id === v.id));
    expect(added.map((v) => [v.name, v.kind, v.groupById, v.isDefault])).toEqual([
      ["Roadmap", "roadmap", release.id, false],
    ]);

    /* Off keeps what it made. */
    expect((await me.del(url)).status).toBe(200);
    const kept = await read();
    expect(kept.project.releaseBy).toBeNull();
    expect(kept.properties.map((x) => x.id)).toContain(release.id);
    expect(kept.views).toHaveLength(after.views.length);

    /* On again makes no second Release and no second Roadmap. */
    expect((await me.post(url)).status).toBe(200);
    const back = await read();
    expect(back.project.releaseBy).toBe(release.id);
    expect(back.properties.filter((x) => x.name === "Release")).toHaveLength(1);
    expect(back.views).toHaveLength(after.views.length);
  });
});

/* ---- e2e/iteration.spec.ts ---------------------------------------------- */

describe("Grouping by an iteration", () => {
  /* The route half of "a picker opens on the current sprint, and grouping by
     one starts on 'is current'". The picker and the chip are
     `board/Sprints.test.tsx`. */
  it("grouping by one starts on 'is current', unless the writer's own filter asks", async () => {
    const { projectId, me, read } = await owned();
    const made = await me.post(`/api/projects/${projectId}/properties`, {
      name: "Sprint",
      type: "iteration",
      options: ["Now", "Next"],
    });
    expect(made.status).toBe(201);
    let b = await read();
    const sprint = b.properties.find((x) => x.name === "Sprint")!;
    const status = b.properties.find((x) => x.name === "Status")!;
    const [now, next] = sprint.options;
    await ok(me.patch(`/api/options/${now.id}`, { startAt: day(-3), targetAt: day(3) }));
    await ok(me.patch(`/api/options/${next.id}`, { startAt: day(4), targetAt: day(10) }));
    const main = b.views.find((v) => v.isDefault)!;

    await ok(me.patch(`/api/views/${main.id}`, { groupById: sprint.id }));
    b = await read();
    expect(b.views.find((v) => v.isDefault)!.filters.rules).toEqual([
      expect.objectContaining({ propertyId: sprint.id, values: ["__current__"] }),
    ]);

    /* ---- a person whose own filter already asks about it gets no second rule */

    await ok(me.patch(`/api/views/${main.id}`, { groupById: status.id, filters: { rules: [] } }));
    await ok(
      me.put(`/api/views/${main.id}/lens`, {
        filters: { rules: [{ propertyId: sprint.id, op: "is", values: [next.id] }] },
      }),
    );
    await ok(me.patch(`/api/views/${main.id}`, { groupById: sprint.id }));
    b = await read();
    expect(b.views.find((v) => v.isDefault)!.filters.rules).toEqual([]);
  });
});
