import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { sql } = await import("drizzle-orm");
const { db } = await import("@/db");
const { buildChangelog } = await import("@/lib/changelog");
const { readShipped, shippedTasks } = await import("@/lib/changelog-read");
const { loadChangelog, loadPublicChangelog } = await import("@/lib/changelog-load");
const { agent, api, board, ok, person, project, unique } = await import("@/test/route");

/*
 * The server's half of a release: Ship, Done when, the changelog and the
 * roadmap. One file, because each file of route tests pays for its own
 * database. Each part names the end to end spec it came from.
 */

/*
 * What a ship writes, and who may ask for one. Each test was a test of
 * `e2e/ship.spec.ts` and carries its name. Move, which archives and moves on,
 * stays end to end; the question the header asks is `Progress.test.tsx`.
 */

type ShipBoard = {
  properties: {
    id: string;
    name: string;
    options: { id: string; name: string; shippedAt: string | null }[];
  }[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
  archived: { id: string; title: string; shippedIn: string | null }[];
};

/*
 * A Version select where v1 is due: three of its tasks are over and one is
 * not. v2 has no date, and v3 is the last option and dated, with one task
 * over and one not.
 */
async function releaseBoard() {
  const owner = await person("Ship Owner");
  const p = await project(owner);
  const me = api(owner);
  const read = async () => (await board(owner, p.id)) as ShipBoard;

  await ok(
    me.post(`/api/projects/${p.id}/properties`, {
      name: "Version",
      type: "select",
      options: ["v1", "v2", "v3"],
    }),
  );
  const first = await read();
  const status = first.properties.find((x) => x.name === "Status")!;
  const done = status.options.find((o) => o.name === "Done")!;
  const backlog = status.options.find((o) => o.name === "Backlog")!;
  const version = first.properties.find((x) => x.name === "Version")!;
  const [v1, v2, v3] = version.options;
  await ok(me.patch(`/api/properties/${version.id}`, { dated: true }));
  for (const option of [v1, v3]) {
    await ok(me.patch(`/api/options/${option.id}`, { targetAt: "2026-10-14" }));
  }

  const task = (title: string, values: Record<string, unknown>) =>
    ok(me.post(`/api/projects/${p.id}/tasks`, { title, values }));
  await task("Alpha", { [version.id]: v1.id, [status.id]: done.id });
  await task("Bravo", { [version.id]: v1.id, [status.id]: done.id });
  await task("Charlie", { [version.id]: v1.id, [status.id]: backlog.id });
  await task("Delta", { [version.id]: v1.id, [status.id]: done.id });
  await task("Echo", { [version.id]: v3.id, [status.id]: done.id });
  await task("Foxtrot", { [version.id]: v3.id, [status.id]: backlog.id });
  await ok(
    me.patch(`/api/projects/${p.id}`, { doneWhen: { propertyId: status.id, optionId: done.id } }),
  );
  return { owner, project: p, me, read, version, v1, v2, v3 };
}

describe("Ship on a column", () => {
  it("Clear takes the value away; Leave keeps it", async () => {
    const { me, read, version, v1, v3 } = await releaseBoard();

    const cleared = await ok(me.post(`/api/options/${v3.id}/ship`, { rest: "clear" }));
    expect(cleared).toMatchObject({ archived: 1, rest: "clear" });
    let b = await read();
    expect(b.tasks.find((t) => t.title === "Foxtrot")!.values[version.id] ?? null).toBeNull();
    expect(b.tasks.some((t) => t.title === "Echo")).toBe(false);

    const leave = await ok(me.post(`/api/options/${v1.id}/ship`, { rest: "leave" }));
    expect(leave).toMatchObject({ archived: 3, moved: 0, rest: "leave" });
    b = await read();
    expect(b.tasks.find((t) => t.title === "Charlie")!.values[version.id]).toBe(v1.id);

    // "next" on the last option is refused before anything moves.
    await ok(me.patch(`/api/options/${v3.id}`, { shippedAt: null }));
    const last = await me.post(`/api/options/${v3.id}/ship`, { rest: "next" });
    expect(last.status).toBe(400);
  });

  /* The agent that deployed ships the release. Unship throws the day away,
     so it stays a person's, an admin's, with the sentence it always had. */
  it("a member token ships as an admin does, and is refused on unship", async () => {
    const byAdmin = await releaseBoard();
    const asAdmin = await ok(
      byAdmin.me.post(`/api/options/${byAdmin.v1.id}/ship`, { rest: "leave" }),
    );

    const { owner, project: p, read, v1 } = await releaseBoard();
    const builder = await agent(owner, p.id);
    const asAgent = await ok(builder.api.post(`/api/options/${v1.id}/ship`, { rest: "leave" }));
    expect(asAgent).toEqual(asAdmin);
    expect(asAgent).toMatchObject({ archived: 3, moved: 0, rest: "leave" });
    const version = (await read()).properties.find((x) => x.name === "Version")!;
    expect(version.options.find((o) => o.id === v1.id)!.shippedAt).not.toBeNull();

    const unship = await builder.api.patch(`/api/options/${v1.id}`, { shippedAt: null });
    expect(unship.status).toBe(403);
    expect(await unship.json()).toMatchObject({ error: "Only a person can do this." });
    expect(
      (await read()).properties.find((x) => x.name === "Version")!.options[0].shippedAt,
    ).not.toBeNull();
  });

  it("an undated option cannot ship, nor a rest nobody said", async () => {
    const { me, read, v1, v2 } = await releaseBoard();

    const undated = await me.post(`/api/options/${v2.id}/ship`, { rest: "leave" });
    expect(undated.status).toBe(400);

    const nonsense = await me.post(`/api/options/${v1.id}/ship`, { rest: "archive" });
    expect(nonsense.status).toBe(400);
    expect((await read()).tasks.some((t) => t.title === "Alpha")).toBe(true);
  });

  /* The server half of "Unship from Settings clears the day and leaves the
     archived tasks archived". The button and its question are in
     `OptionDates.test.tsx`; they send exactly this patch. */
  it("Unship clears the day and leaves the archived tasks archived", async () => {
    const { me, read, v1 } = await releaseBoard();
    await ok(me.post(`/api/options/${v1.id}/ship`, { rest: "next" }));

    await ok(me.patch(`/api/options/${v1.id}`, { shippedAt: null }));

    const b = await read();
    const version = b.properties.find((x) => x.name === "Version")!;
    expect(version.options.find((o) => o.id === v1.id)!.shippedAt).toBeNull();
    expect(b.tasks.map((t) => t.title).sort()).toEqual(["Charlie", "Echo", "Foxtrot"]);
    expect(b.archived.map((t) => t.title).sort()).toEqual(["Alpha", "Bravo", "Delta"]);
  });
});

/*
 * The Archived page says why a task left. The word is the changelog's, read
 * on the board answer: the shipped release a task carries, or nothing.
 */
describe("An archived task says what shipped it", () => {
  it("names the release a ship archived it in, and nothing for a hand archive", async () => {
    const { me, read, v1 } = await releaseBoard();
    const echo = (await read()).tasks.find((t) => t.title === "Echo")!;
    await ok(me.post(`/api/tasks/${echo.id}/archive`));
    await ok(me.post(`/api/options/${v1.id}/ship`, { rest: "leave" }));

    const shippedIn = (b: ShipBoard) =>
      Object.fromEntries(b.archived.map((t) => [t.title, t.shippedIn]));
    expect(shippedIn(await read())).toEqual({
      Alpha: "v1",
      Bravo: "v1",
      Delta: "v1",
      // v3 has not shipped, so Echo went by hand.
      Echo: null,
    });

    // Unship throws the day away, and the changelog with it, so the word goes too.
    await ok(me.patch(`/api/options/${v1.id}`, { shippedAt: null }));
    expect(Object.values(shippedIn(await read()))).toEqual([null, null, null, null]);
  });
});

/* With no Done when nothing is over, so a new project could not ship. It
   starts with its Status ending in Done, and that is what Done when names. */
describe("A new project knows what done means", () => {
  it("Done when is the last option of Status, and Ship archives what is in it", async () => {
    const owner = await person("New Owner");
    const p = await project(owner);
    const me = api(owner);
    const read = async () => (await board(owner, p.id)) as DoneBoard;

    const first = await read();
    const status = first.properties.find((x) => x.name === "Status")!;
    const done = status.options.at(-1)!;
    expect(done.name).toBe("Done");
    expect(first.project.doneWhen).toEqual({ propertyId: status.id, optionIds: [done.id] });

    await ok(
      me.post(`/api/projects/${p.id}/properties`, {
        name: "Version",
        type: "select",
        options: ["v1"],
      }),
    );
    const version = (await read()).properties.find((x) => x.name === "Version")!;
    const v1 = version.options[0];
    await ok(me.patch(`/api/properties/${version.id}`, { dated: true }));
    await ok(me.patch(`/api/options/${v1.id}`, { targetAt: "2026-10-14" }));
    const backlog = status.options.find((o) => o.name === "Backlog")!;
    const made = async (title: string, optionId: string) =>
      (
        await ok<{ task: { id: string } }>(
          me.post(`/api/projects/${p.id}/tasks`, {
            title,
            values: { [version.id]: v1.id, [status.id]: optionId },
          }),
        )
      ).task.id;
    const finished = await made("Finished", done.id);
    const open = await made("Open", backlog.id);

    expect(await ok(me.post(`/api/options/${v1.id}/ship`, { rest: "leave" }))).toMatchObject({
      archived: 1,
    });
    const b = await read();
    expect(b.archived.map((t) => t.id)).toEqual([finished]);
    expect(b.tasks.map((t) => t.id)).toContain(open);
  });
});

/*
 * What frees a blocker and what Ship archives, when Done when names more than
 * one option. Each test was a test of `e2e/done-when.spec.ts` and carries its
 * name. The ticks in Settings are `ProjectPanel.test.tsx`.
 */

type DoneOption = { id: string; name: string };
type DoneBoard = {
  project: { doneWhen: { propertyId: string; optionIds: string[] } | null };
  properties: { id: string; name: string; options: DoneOption[] }[];
  tasks: { id: string; title: string; blockedBy: string[] }[];
  archived: { id: string }[];
};

/* A project whose Status ends in two ways, Done and Won't do, and a task
   that waits on another. */
async function twoEnds() {
  const owner = await person("Done Owner");
  const p = await project(owner);
  const me = api(owner);
  const read = async () => (await board(owner, p.id)) as DoneBoard;

  const status = (await read()).properties.find((x) => x.name === "Status")!;
  await ok(me.post(`/api/properties/${status.id}/options`, { name: "Won't do" }));
  const options = (await read()).properties.find((x) => x.id === status.id)!.options;
  const named = (name: string) => options.find((o) => o.name === name)!;
  const shipped = named("Done");
  const wont = named("Won't do");
  const backlog = named("Backlog");

  const made = async (title: string, values: Record<string, unknown> = {}) =>
    (await ok<{ task: { id: string } }>(me.post(`/api/projects/${p.id}/tasks`, { title, values })))
      .task.id;
  const blocker = await made("The blocker", { [status.id]: backlog.id });
  const waiting = await made("The waiting task", { [status.id]: backlog.id });
  await ok(me.post(`/api/tasks/${waiting}/blockers`, { blockerId: blocker }));

  const set = (taskId: string, optionId: string) =>
    ok(me.put(`/api/tasks/${taskId}/values/${status.id}`, { value: optionId }));
  const blocked = async () => (await read()).tasks.find((t) => t.id === waiting)!.blockedBy.length;
  const doneWhen = (data: unknown) => me.patch(`/api/projects/${p.id}`, { doneWhen: data });

  return {
    project: p,
    me,
    read,
    status,
    shipped,
    wont,
    backlog,
    blocker,
    made,
    set,
    blocked,
    doneWhen,
  };
}

describe("Done when names more than one option", () => {
  it("a task in any picked option is over, so Won't do frees what waits on it", async () => {
    const { read, status, shipped, wont, backlog, blocker, set, blocked, doneWhen } =
      await twoEnds();
    await ok(doneWhen({ propertyId: status.id, optionIds: [wont.id, shipped.id] }));
    // The property's own order, whatever order the write named them in.
    expect((await read()).project.doneWhen).toEqual({
      propertyId: status.id,
      optionIds: [shipped.id, wont.id],
    });

    expect(await blocked()).toBe(1);
    await set(blocker, wont.id);
    expect(await blocked()).toBe(0);
    await set(blocker, shipped.id);
    expect(await blocked()).toBe(0);
    await set(blocker, backlog.id);
    expect(await blocked()).toBe(1);
  });

  it("a project saved with one option still blocks and frees as before", async () => {
    const {
      project: p,
      read,
      status,
      shipped,
      wont,
      backlog,
      blocker,
      set,
      blocked,
      doneWhen,
    } = await twoEnds();
    // The shape a release before the list wrote, put straight in the row.
    const old = JSON.stringify({ propertyId: status.id, optionId: shipped.id });
    await db.execute(sql`update projects set done_when = ${old}::jsonb where id = ${p.id}`);
    expect((await read()).project.doneWhen).toEqual({
      propertyId: status.id,
      optionIds: [shipped.id],
    });
    expect(await blocked()).toBe(1);
    await set(blocker, wont.id);
    expect(await blocked()).toBe(1);
    await set(blocker, shipped.id);
    expect(await blocked()).toBe(0);
    await set(blocker, backlog.id);
    expect(await blocked()).toBe(1);

    // A write in the old shape is still taken, as a list of one.
    await ok(doneWhen({ propertyId: status.id, optionId: wont.id }));
    expect((await read()).project.doneWhen).toEqual({
      propertyId: status.id,
      optionIds: [wont.id],
    });
  });

  it("a write naming an option of another property is refused", async () => {
    const { project: p, me, read, status, shipped, doneWhen } = await twoEnds();
    await ok(
      me.post(`/api/projects/${p.id}/properties`, {
        name: "Version",
        type: "select",
        options: ["v1"],
      }),
    );
    const v1 = (await read()).properties.find((x) => x.name === "Version")!.options[0];

    const refused = await doneWhen({ propertyId: status.id, optionIds: [shipped.id, v1.id] });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe(
      "Every option of Done when has to be an option of Status.",
    );
    expect((await read()).project.doneWhen).toEqual({
      propertyId: status.id,
      optionIds: [shipped.id],
    });
  });

  it("Ship archives tasks in every picked option", async () => {
    const {
      project: p,
      me,
      read,
      status,
      shipped,
      wont,
      backlog,
      made,
      doneWhen,
    } = await twoEnds();
    await ok(doneWhen({ propertyId: status.id, optionIds: [shipped.id, wont.id] }));
    await ok(
      me.post(`/api/projects/${p.id}/properties`, {
        name: "Version",
        type: "select",
        options: ["v1", "v2"],
      }),
    );
    const property = (await read()).properties.find((x) => x.name === "Version")!;
    const v1 = property.options[0];
    await ok(me.patch(`/api/properties/${property.id}`, { dated: true }));
    await ok(me.patch(`/api/options/${v1.id}`, { targetAt: "2026-10-14" }));

    const done = await made("Shipped work", { [property.id]: v1.id, [status.id]: shipped.id });
    const dropped = await made("Dropped work", { [property.id]: v1.id, [status.id]: wont.id });
    const open = await made("Open work", { [property.id]: v1.id, [status.id]: backlog.id });

    await ok(me.post(`/api/options/${v1.id}/ship`, { rest: "leave" }));
    const b = await read();
    const archived = b.archived.map((t) => t.id);
    expect(archived).toContain(done);
    expect(archived).toContain(dropped);
    expect(archived).not.toContain(open);
    expect(b.tasks.map((t) => t.id)).toContain(open);
  });

  it("deleting one picked option leaves the rest working", async () => {
    const { me, read, status, shipped, wont, backlog, blocker, set, blocked, doneWhen } =
      await twoEnds();
    await ok(doneWhen({ propertyId: status.id, optionIds: [shipped.id, wont.id] }));
    await ok(me.del(`/api/options/${wont.id}`));

    expect((await read()).project.doneWhen).toEqual({
      propertyId: status.id,
      optionIds: [shipped.id],
    });
    expect(await blocked()).toBe(1);
    await set(blocker, shipped.id);
    expect(await blocked()).toBe(0);
    await set(blocker, backlog.id);
    expect(await blocked()).toBe(1);

    // With none left, archived is the only word for over again.
    await ok(me.del(`/api/options/${shipped.id}`));
    expect((await read()).project.doneWhen).toBeNull();
  });
});

/*
 * What the changelog holds, for a member, an agent and a stranger. Each test
 * was a test of `e2e/changelog.spec.ts` and carries its name. One shipped
 * walk stays end to end; the button and the phone's way in are
 * `ProjectPanel.test.tsx`.
 */

type ChangelogBoard = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
};

let keys = 0;
/** A key nobody else in this file has, because the public address is the key. */
function freshKey(): string {
  keys += 1;
  return `CL${String.fromCharCode(64 + keys)}`;
}

/*
 * A project with a Version property: v1 shipped first, v2 shipped last, v3
 * not yet. One task of v1 is archived, as a ship would leave it.
 */
async function shippedProject() {
  const owner = await person("Hidden Person");
  const p = await project(owner, unique("Changes"));
  const me = api(owner);
  const key = freshKey();
  await ok(me.patch(`/api/projects/${p.id}`, { key }));
  await ok(
    me.post(`/api/projects/${p.id}/properties`, {
      name: "Version",
      type: "select",
      options: ["v1", "v2", "v3"],
    }),
  );
  const version = ((await board(owner, p.id)) as ChangelogBoard).properties.find(
    (x) => x.name === "Version",
  )!;
  const [v1, v2, v3] = version.options;
  // Use releases takes the dated select there is, so Version is the releases.
  await ok(me.patch(`/api/properties/${version.id}`, { dated: true }));
  await ok(me.post(`/api/projects/${p.id}/releases`));
  await ok(
    me.patch(`/api/options/${v1.id}`, { shippedAt: "2026-09-01", note: "The **first** one." }),
  );
  await ok(me.patch(`/api/options/${v2.id}`, { shippedAt: "2026-10-01" }));

  const task = async (title: string, values: Record<string, unknown>) =>
    (await ok<{ task: { id: string } }>(me.post(`/api/projects/${p.id}/tasks`, { title, values })))
      .task.id;
  const first = await task("Alpha lands", { [version.id]: v1.id });
  await task("Bravo lands", { [version.id]: v1.id });
  await task("Charlie lands", { [version.id]: v2.id });
  await task("Delta waits", { [version.id]: v3.id });
  await ok(me.post(`/api/tasks/${first}/archive`));

  return { owner, project: p, me, key, version, task };
}

describe("The changelog", () => {
  it("answers an agent's token with the same data", async () => {
    const { owner, project: p, key } = await shippedProject();
    const builder = await agent(owner, p.id);
    const { changelog } = await ok<{
      changelog: {
        name: string;
        shippedAt: string;
        note: string | null;
        tasks: { key: string; title: string }[];
      }[];
    }>(builder.api.get(`/api/projects/${p.id}/changelog`));
    expect(changelog.map((e) => [e.name, e.shippedAt, e.note])).toEqual([
      ["v2", "2026-10-01", null],
      ["v1", "2026-09-01", "The **first** one."],
    ]);
    expect(changelog[1].tasks.map((t) => t.title)).toEqual(["Alpha lands", "Bravo lands"]);
    expect(changelog[1].tasks[0].key).toMatch(new RegExp(`^${key}-\\d+$`));
  });

  /* The server half of "is private until somebody makes it public". The
     public page draws what `loadPublicChangelog` answers, and a 404 for null. */
  it("is private until somebody makes it public", async () => {
    const { project: p, me, key } = await shippedProject();
    const slug = key.toLowerCase();
    expect(await loadPublicChangelog(slug)).toBeNull();

    await ok(me.patch(`/api/projects/${p.id}`, { publicChangelog: true }));
    const log = await loadPublicChangelog(slug);
    expect(log!.entries.map((e) => e.name)).toEqual(["v2", "v1"]);
    expect(log!.entries[0].tasks.map((t) => t.title)).toEqual(["Charlie lands"]);
    // A stranger reads no keys and no people.
    const said = JSON.stringify(log);
    expect(said).not.toContain(`${key}-`);
    expect(said).not.toContain("Hidden Person");

    // And off again is off at once.
    await ok(me.patch(`/api/projects/${p.id}`, { publicChangelog: false }));
    expect(await loadPublicChangelog(slug)).toBeNull();
  });

  /* Off clears the pointer and nothing else, so on again finds the same
     entries. The pages answer not found for null; an agent reads an empty list. */
  it("is there only while releases are on", async () => {
    const { owner, project: p, me, key } = await shippedProject();
    const slug = key.toLowerCase();
    await ok(me.patch(`/api/projects/${p.id}`, { publicChangelog: true }));
    const before = await loadChangelog(p.id);
    expect(before!.entries.map((e) => [e.name, e.note])).toEqual([
      ["v2", null],
      ["v1", "The **first** one."],
    ]);

    await ok(me.del(`/api/projects/${p.id}/releases`));
    expect(await loadChangelog(p.id)).toBeNull();
    expect(await loadPublicChangelog(slug)).toBeNull();
    const builder = await agent(owner, p.id);
    expect(await ok(builder.api.get(`/api/projects/${p.id}/changelog`))).toEqual({ changelog: [] });

    await ok(me.post(`/api/projects/${p.id}/releases`));
    expect(await loadChangelog(p.id)).toEqual(before);
    expect((await loadPublicChangelog(slug))!.entries.map((e) => e.name)).toEqual(["v2", "v1"]);
  });

  it("reads only the shipped tasks, and builds the same changelog as a read of every task", async () => {
    const { project: p, me, version, task } = await shippedProject();
    const [v1, v2] = version.options;

    /* A deleted task of a shipped option stays out, and a text value that
       spells an option id is not a pick of that option. */
    const gone = await task("Echo was a mistake", { [version.id]: v2.id });
    await ok(me.del(`/api/tasks/${gone}`));
    const note = await ok<{ property: { id: string } }>(
      me.post(`/api/projects/${p.id}/properties`, { name: "Note", type: "text" }),
    );
    await task("Foxtrot names a version", { [note.property.id]: v1.id });

    /* A closed sprint is not a release. Golf carries a shipped version and a
       closed sprint, and only the version is read; Hotel sits in a sprint
       that is still open. */
    const { property: sprint } = await ok<{ property: ChangelogBoard["properties"][number] }>(
      me.post(`/api/projects/${p.id}/properties`, {
        name: "Sprint",
        type: "iteration",
        options: ["Old", "Now"],
      }),
    );
    const [old, now] = sprint.options;
    await ok(
      me.patch(`/api/options/${old.id}`, {
        startAt: "2026-08-01",
        targetAt: "2026-08-14",
        shippedAt: "2026-08-14",
      }),
    );
    await ok(me.patch(`/api/options/${now.id}`, { startAt: "2099-01-01", targetAt: "2099-01-14" }));
    await task("Golf ships twice", { [version.id]: v2.id, [sprint.id]: old.id });
    await task("Hotel waits in a sprint", { [sprint.id]: now.id });

    const rows = <T>(q: ReturnType<typeof sql>) =>
      db.execute(q).then((r) => (r as unknown as { rows: T[] }).rows);
    const props = await rows<{ id: string; name: string; type: string }>(
      sql`select id, name, type from properties where project_id = ${p.id} order by position`,
    );
    const opts = await rows<{
      id: string;
      property_id: string;
      name: string;
      shipped_at: string | null;
      note: string | null;
    }>(
      sql`select o.id, o.property_id, o.name, to_char(o.shipped_at, 'YYYY-MM-DD') as shipped_at,
                 o.note
            from property_options o join properties p on p.id = o.property_id
           where p.project_id = ${p.id} order by o.position`,
    );
    const properties = props.map((x) => ({
      ...x,
      options: opts
        .filter((o) => o.property_id === x.id)
        .map((o) => ({ id: o.id, name: o.name, shippedAt: o.shipped_at, note: o.note })),
    }));
    const named = { id: p.id, name: "Changes", key: "C" };

    // The read the loader made before: every task, every value.
    const all = await rows<{ id: string; number: number; title: string; position: string }>(
      sql`select id, number, title, position from tasks
           where project_id = ${p.id} and deleted_at is null`,
    );
    const allValues = await rows<{ task_id: string; property_id: string; value: unknown }>(
      sql`select v.task_id, v.property_id, v.value from task_values v
            join tasks t on t.id = v.task_id
           where t.project_id = ${p.id} and t.deleted_at is null`,
    );
    const before = buildChangelog({
      project: named,
      properties,
      tasks: all.map((t) => ({
        ...t,
        values: Object.fromEntries(
          allValues.filter((v) => v.task_id === t.id).map((v) => [v.property_id, v.value]),
        ),
      })),
    });

    const shipped = await readShipped(db as never, p.id);
    expect(shipped.map((r) => r.title).sort()).toEqual([
      "Alpha lands",
      "Bravo lands",
      "Charlie lands",
      "Golf ships twice",
    ]);
    const after = buildChangelog({ project: named, properties, tasks: shippedTasks(shipped) });

    expect(after).toEqual(before);
    expect(after.entries.map((e) => e.tasks.map((t) => t.title))).toEqual([
      ["Charlie lands", "Golf ships twice"],
      ["Alpha lands", "Bravo lands"],
    ]);
  });

  /* A page opens on the newest ten, and **Older** is the same page asking for
     twenty. The route an agent reads still answers every release. */
  it("opens on the newest ten releases, and reads the next ten when asked", async () => {
    const { owner, project: p, me, key, version, task } = await shippedProject();
    const names = Array.from({ length: 10 }, (_, i) => `w${i + 1}`);
    for (const [i, name] of names.entries()) {
      const { option } = await ok<{ option: { id: string } }>(
        me.post(`/api/properties/${version.id}/options`, { name }),
      );
      await ok(
        me.patch(`/api/options/${option.id}`, {
          shippedAt: `2026-11-${String(i + 1).padStart(2, "0")}`,
        }),
      );
    }
    await ok(me.patch(`/api/projects/${p.id}`, { publicChangelog: true }));
    const slug = key.toLowerCase();

    const first = (await loadChangelog(p.id, 10))!;
    expect(first.entries.map((e) => e.name)).toEqual([...names].reverse());
    expect(first.older).toBe(2);
    expect((await loadPublicChangelog(slug, 10))!.older).toBe(2);

    const both = (await loadChangelog(p.id, 20))!;
    expect(both.entries.map((e) => e.name).slice(-2)).toEqual(["v2", "v1"]);
    expect(both.entries.at(-1)!.tasks.map((t) => t.title)).toEqual(["Alpha lands", "Bravo lands"]);
    expect(both.older).toBe(0);

    // A page of ten reads the tasks of those ten and no others.
    const ten = first.entries.map((e) => e.optionId);
    expect(await readShipped(db as never, p.id, ten)).toEqual([]);
    await task("Kilo lands", { [version.id]: first.entries[0].optionId });
    expect((await readShipped(db as never, p.id, ten)).map((r) => r.title)).toEqual(["Kilo lands"]);

    const builder = await agent(owner, p.id);
    const { changelog } = await ok<{ changelog: unknown[] }>(
      builder.api.get(`/api/projects/${p.id}/changelog`),
    );
    expect(changelog).toHaveLength(12);
  });

  /* A stranger's page is kept between visits. A write that went past the
     routes is not seen, which is how the test knows it was kept; a ship
     through its route is seen on the next visit. */
  it("keeps the public page between visits, and shows a ship on the next one", async () => {
    const { project: p, me, key, version } = await shippedProject();
    await ok(me.patch(`/api/projects/${p.id}`, { publicChangelog: true }));
    const slug = key.toLowerCase();
    const names = async () => (await loadPublicChangelog(slug, 10))!.entries.map((e) => e.name);
    expect(await names()).toEqual(["v2", "v1"]);

    const v3 = version.options[2];
    await db.execute(sql`update property_options set name = 'v3 by hand' where id = ${v3.id}`);
    await db.execute(sql`update property_options set name = 'v2 by hand'
                          where id = ${version.options[1].id}`);
    expect(await names()).toEqual(["v2", "v1"]);

    await ok(me.patch(`/api/options/${v3.id}`, { targetAt: "2026-10-14" }));
    await ok(me.post(`/api/options/${v3.id}/ship`, { rest: "leave" }));
    expect(await names()).toEqual(["v3 by hand", "v2 by hand", "v1"]);
  });

  it("lets one project per key be public", async () => {
    const { owner, project: first, me, key } = await shippedProject();
    await ok(me.patch(`/api/projects/${first.id}`, { publicChangelog: true }));

    const second = await project(owner, unique("Twin"));
    await ok(me.patch(`/api/projects/${second.id}`, { key }));
    const refused = await me.patch(`/api/projects/${second.id}`, { publicChangelog: true });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe(
      `Another project with the key ${key} already has a public changelog.`,
    );
  });
});

/*
 * What the server answers a roadmap. Each test was a test of
 * `e2e/roadmap.spec.ts` and carries its name. Where the bars start is
 * `roadmap.test.ts`, which already held the rest of the first test here; the
 * canvas and the panel are `Roadmap.test.tsx`.
 */

type RoadmapBoard = {
  today: string;
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  archivedUnder: Record<string, { firstAt: string; count: number; taskIds: string[] }>;
};

async function versions() {
  const owner = await person("Roadmap Owner");
  const p = await project(owner);
  const me = api(owner);
  const read = async () => (await board(owner, p.id)) as RoadmapBoard;
  await ok(
    me.post(`/api/projects/${p.id}/properties`, {
      name: "Version",
      type: "select",
      options: ["Ghost", "Beta", "Alpha", "Someday"],
    }),
  );
  const b = await read();
  const version = b.properties.find((x) => x.name === "Version")!;
  const id = (name: string) => version.options.find((o) => o.name === name)!.id;
  return { project: p, me, read, version, id, today: b.today, properties: b.properties };
}

describe("A roadmap", () => {
  /* The route half of "starts the first bar at its oldest task, the next
     after it, and asks for a select". The two bars are `roadmap.test.ts`:
     "starts at the oldest task under the option when it has no start" and
     "begins an option with no start the day after the previous dated
     option's target". */
  it("asks for a select", async () => {
    const { project: p, me, properties, version } = await versions();
    const assignee = properties.find((x) => x.name === "Assignee")!;
    const wrong = await me.post(`/api/projects/${p.id}/views`, {
      name: "Bad",
      kind: "roadmap",
      groupById: assignee.id,
    });
    expect(wrong.status).toBe(400);

    const right = await me.post(`/api/projects/${p.id}/views`, {
      name: "Plan",
      kind: "roadmap",
      groupById: version.id,
    });
    expect(right.status).toBe(201);
  });

  /* The board half of "a shipped option keeps its start in its archived
     work, and a filter takes rows away". */
  it("a shipped option's archived work is sent in archivedUnder", async () => {
    const { project: p, me, read, version, id, today } = await versions();
    await ok(
      me.patch(`/api/options/${id("Alpha")}`, {
        targetAt: today,
        shippedAt: today,
      }),
    );
    const made = await ok<{ task: { id: string } }>(
      me.post(`/api/projects/${p.id}/tasks`, {
        title: "Done work",
        values: { [version.id]: id("Alpha") },
      }),
    );
    await ok(me.post(`/api/tasks/${made.task.id}/archive`));

    const under = (await read()).archivedUnder[id("Alpha")];
    expect(under).toMatchObject({ count: 1, taskIds: [made.task.id] });
    expect(under.firstAt.slice(0, 10) <= today).toBe(true);
  });
});

/*
 * The over tasks that are in no release. Ship takes them with `strays: true`:
 * they get the option, go with the rest, and the changelog names them. The
 * tick that sends it is `Roadmap.test.tsx`, and the walk is `e2e/ship.spec.ts`.
 */
describe("Ship takes the over tasks in no release", () => {
  type Line = { taskId: string | null; kind: string; data: Record<string, unknown> };

  async function withStrays() {
    const made = await releaseBoard();
    const { project: p, me, read } = made;
    const status = (await read()).properties.find((x) => x.name === "Status")!;
    const named = (name: string) => status.options.find((o) => o.name === name)!.id;
    const task = (title: string, values: Record<string, unknown>) =>
      ok(me.post(`/api/projects/${p.id}/tasks`, { title, values }));
    await task("Golf", { [status.id]: named("Done") });
    await task("Hotel", { [status.id]: named("Done") });
    await task("India", { [status.id]: named("Backlog") });
    await task("Juliet", { [made.version.id]: made.v2.id, [status.id]: named("Done") });
    await ok(me.post(`/api/projects/${p.id}/releases`));
    const cursor = (await ok<{ now: string }>(me.get(`/api/projects/${p.id}/activity`))).now;
    const feed = async () =>
      (
        await ok<{ entries: Line[] }>(
          me.get(`/api/projects/${p.id}/activity?after=${encodeURIComponent(cursor)}`),
        )
      ).entries;
    return { ...made, feed };
  }

  it("with the tick on, they are archived under the release, the changelog lists them, and their lines carry the shipId", async () => {
    const { project: p, me, read, v1, feed } = await withStrays();

    const done = await ok(me.post(`/api/options/${v1.id}/ship`, { rest: "leave", strays: true }));
    expect(done).toMatchObject({ archived: 5, taken: 2, moved: 0 });

    const b = await read();
    expect(b.archived.map((t) => t.title).sort()).toEqual([
      "Alpha",
      "Bravo",
      "Delta",
      "Golf",
      "Hotel",
    ]);
    // Not over, or in another release: they belong where they are.
    expect(b.tasks.map((t) => t.title)).toEqual(expect.arrayContaining(["India", "Juliet"]));

    const log = await loadChangelog(p.id);
    const v1Entry = log!.entries.find((e) => e.name === "v1")!;
    expect(v1Entry.tasks.map((t) => t.title)).toEqual(expect.arrayContaining(["Golf", "Hotel"]));
    expect(v1Entry.tasks.map((t) => t.title)).not.toContain("India");

    const lines = await feed();
    const shipped = lines.find((l) => l.taskId === null && l.data.action === "shipped")!;
    const shipId = shipped.data.shipId;
    expect(shipped.data).toMatchObject({ archived: 5, taken: 2 });
    const ids = Object.fromEntries(b.archived.map((t) => [t.id, t.title]));
    const taken = lines.filter((l) => ["Golf", "Hotel"].includes(ids[l.taskId ?? ""]));
    expect(taken.map((l) => l.kind).sort()).toEqual(["archive", "archive", "value", "value"]);
    for (const line of taken) expect(line.data.shipId).toBe(shipId);
  });

  it("with the tick off, they stay where they were", async () => {
    const { me, read, version, v1 } = await withStrays();

    const done = await ok(me.post(`/api/options/${v1.id}/ship`, { rest: "leave" }));
    expect(done).toMatchObject({ archived: 3, taken: 0 });

    const b = await read();
    for (const title of ["Golf", "Hotel"]) {
      const t = b.tasks.find((x) => x.title === title)!;
      expect(t.values[version.id] ?? null).toBeNull();
    }
  });

  it("a sprint close takes none, even when asked", async () => {
    const { project: p, me, read } = await withStrays();
    await ok(me.post(`/api/projects/${p.id}/sprints`));
    const sprint = (await read()).properties.find((x) => x.name === "Sprint")!;

    const done = await ok(
      me.post(`/api/options/${sprint.options[0].id}/ship`, { rest: "leave", strays: true }),
    );
    expect(done).toMatchObject({ archived: 0, taken: 0 });
    const b = await read();
    expect(b.archived).toEqual([]);
    expect(b.tasks.find((t) => t.title === "Golf")!.values[sprint.id] ?? null).toBeNull();
  });
});
