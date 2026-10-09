import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/db");
const { agent, api, board, ok, person, project } = await import("@/test/route");

/*
 * The server's half of "a value its task does not show is dropped". Each test
 * was a test of `e2e/drop-hidden.spec.ts` and carries its name. What the panel,
 * the bar and Settings ask before they write is `DropHidden.test.tsx`; the
 * sums behind the questions are `when-drop.test.ts`. "Writes to one task at
 * once all land" stayed end to end: one in-memory database answers one request
 * at a time, so it cannot lose the race the lock is there for.
 */

type Option = { id: string; name: string };
type Property = { id: string; name: string; options: Option[] };
type Dropped = { taskId: string; propertyId: string; name: string };
type Detail = { task: { activity: { kind: string; data: Record<string, unknown> }[] } };
type Caller = Awaited<ReturnType<typeof person>>;

async function properties(who: Caller, projectId: string) {
  return (await board(who, projectId)).properties as Property[];
}

async function valuesOf(who: Caller, projectId: string, title: string) {
  const read = await board(who, projectId);
  return (read.tasks as { title: string; values: Record<string, unknown> }[]).find(
    (t) => t.title === title,
  )!.values;
}

/**
 * A project with a Type select of Bug and Story, Priority shown only for a
 * Bug, and two bugs with an Urgent priority. Priority stands in for Severity,
 * because it is on the card of a new project already.
 */
async function bugs(rule = true) {
  const owner = await person("Drop owner");
  const p = await project(owner);
  const mine = api(owner);
  await ok(
    mine.post(`/api/projects/${p.id}/properties`, {
      name: "Type",
      type: "select",
      options: ["Bug", "Story"],
    }),
  );
  const read = await properties(owner, p.id);
  const of = (n: string) => read.find((x) => x.name === n)!;
  const [type, priority, status] = [of("Type"), of("Priority"), of("Status")];
  const opt = (prop: Property, n: string) => prop.options.find((o) => o.name === n)!.id;
  const [bug, story] = [opt(type, "Bug"), opt(type, "Story")];
  const [urgent, todo] = [opt(priority, "Urgent"), opt(status, "Todo")];
  const ids: Record<string, string> = {};
  for (const title of ["First bug", "Second bug"]) {
    const made = await ok<{ task: { id: string } }>(
      mine.post(`/api/projects/${p.id}/tasks`, {
        title,
        values: { [status.id]: todo, [type.id]: bug, [priority.id]: urgent },
      }),
    );
    ids[title] = made.task.id;
  }
  if (rule)
    await ok(
      mine.patch(`/api/properties/${priority.id}`, {
        when: { propertyId: type.id, optionIds: [bug] },
      }),
    );
  return {
    owner,
    mine,
    projectId: p.id,
    type,
    priority,
    status,
    bug,
    story,
    urgent,
    todo,
    ids,
    valuesOf: (title: string) => valuesOf(owner, p.id, title),
  };
}

/**
 * Three rules in a circle, so all three read as none: Area shows for a Bug,
 * Type for a Small task, Size for a Front one. No route writes a circle, so the
 * rules go straight in. A Story in the Back, sized Big, shows all three, and
 * loses its Area the moment Type's rule goes and Area's comes on.
 */
async function circle() {
  const owner = await person("Circle owner");
  const p = await project(owner);
  const mine = api(owner);
  const selects = { Type: ["Bug", "Story"], Area: ["Front", "Back"], Size: ["Big", "Small"] };
  for (const [name, options] of Object.entries(selects))
    await ok(mine.post(`/api/projects/${p.id}/properties`, { name, type: "select", options }));
  const read = await properties(owner, p.id);
  const of = (n: string) => read.find((x) => x.name === n)!;
  const opt = (prop: Property, n: string) => prop.options.find((o) => o.name === n)!.id;
  const [type, area, size] = [of("Type"), of("Area"), of("Size")];
  await ok(
    mine.post(`/api/projects/${p.id}/tasks`, {
      title: "A story",
      values: {
        [type.id]: opt(type, "Story"),
        [area.id]: opt(area, "Back"),
        [size.id]: opt(size, "Big"),
      },
    }),
  );
  const rules: [Property, Property, string][] = [
    [area, type, opt(type, "Bug")],
    [type, size, opt(size, "Small")],
    [size, area, opt(area, "Front")],
  ];
  for (const [on, by, optionId] of rules)
    await db.execute(
      sql`update properties set config = config || jsonb_build_object('when', ${JSON.stringify({ propertyId: by.id, optionIds: [optionId] })}::jsonb) where id = ${on.id}`,
    );
  const values = () => valuesOf(owner, p.id, "A story");
  expect(await values()).toHaveProperty(area.id);
  return { mine, area, type, size, small: opt(size, "Small"), values };
}

describe("A value its task does not show is dropped", () => {
  it("the value, bulk and move routes drop at once and answer with what went", async () => {
    const { mine, projectId, type, priority, status, story, bug, urgent, todo, ids, valuesOf } =
      await bugs();
    const first = ids["First bug"];

    const set = await ok<{ dropped: Dropped[] }>(
      mine.put(`/api/tasks/${first}/values/${type.id}`, { value: story }),
    );
    expect(set.dropped).toEqual([{ taskId: first, propertyId: priority.id, name: "Priority" }]);
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);

    /* The task says what went, in one line. */
    const detail = await ok<Detail>(mine.get(`/api/tasks/${first}`));
    const line = detail.task.activity.find((a) => a.kind === "value" && a.data.dropped);
    expect(line?.data).toMatchObject({
      dropped: ["Priority"],
      propertyIds: [priority.id],
      hidBy: "Story",
    });

    /* A write that hides nothing answers with an empty list. */
    const again = await ok<{ dropped: Dropped[] }>(
      mine.put(`/api/tasks/${first}/values/${type.id}`, { value: story }),
    );
    expect(again.dropped).toEqual([]);

    /* A write to a property the task does not show is accepted and dropped. */
    const hidden = await ok<{ dropped: Dropped[] }>(
      mine.put(`/api/tasks/${first}/values/${priority.id}`, { value: urgent }),
    );
    expect(hidden.dropped).toHaveLength(1);
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);

    /* A drag across columns of Type drops in the same call. */
    const second = ids["Second bug"];
    const moved = await ok<{ dropped: Dropped[] }>(
      mine.post(`/api/tasks/${second}/move`, { values: { [type.id]: story } }),
    );
    expect(moved.dropped).toEqual([{ taskId: second, propertyId: priority.id, name: "Priority" }]);
    expect(await valuesOf("Second bug")).not.toHaveProperty(priority.id);

    /* A bulk set answers for every task. */
    for (const id of [first, second]) {
      await ok(mine.put(`/api/tasks/${id}/values/${type.id}`, { value: bug }));
      await ok(mine.put(`/api/tasks/${id}/values/${priority.id}`, { value: urgent }));
    }
    const bulk = await ok<{ set: number; dropped: Dropped[] }>(
      mine.post(`/api/projects/${projectId}/tasks/values`, {
        taskIds: [first, second],
        propertyId: type.id,
        value: story,
      }),
    );
    expect(bulk.set).toBe(2);
    expect(bulk.dropped.map((d) => d.taskId).sort()).toEqual([first, second].sort());

    /* A bulk set of another property drops nothing. */
    const plain = await ok<{ dropped: Dropped[] }>(
      mine.post(`/api/projects/${projectId}/tasks/values`, {
        taskIds: [first],
        propertyId: status.id,
        value: todo,
      }),
    );
    expect(plain.dropped).toEqual([]);
  });

  it("an agent write, an option delete and a ship drop at once", async () => {
    const { owner, mine, projectId, type, priority, story, bug, urgent, ids, valuesOf } =
      await bugs();

    const helper = await agent(owner, projectId, "Helper");
    const asAgent = await ok<{ dropped: Dropped[] }>(
      helper.api.put(`/api/tasks/${ids["First bug"]}/values/${type.id}`, { value: story }),
    );
    expect(asAgent.dropped).toHaveLength(1);
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);

    /* Shown for a Bug or a Story; Story goes, and a task that was a Story is
       left with no type, which does not show Priority. */
    await ok(
      mine.patch(`/api/properties/${priority.id}`, {
        when: { propertyId: type.id, optionIds: [bug, story] },
      }),
    );
    await ok(mine.put(`/api/tasks/${ids["First bug"]}/values/${priority.id}`, { value: urgent }));
    expect(await valuesOf("First bug")).toHaveProperty(priority.id, urgent);
    await ok(mine.del(`/api/options/${story}`));
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);
    expect(await valuesOf("Second bug")).toHaveProperty(priority.id, urgent);
    const detail = await ok<Detail>(mine.get(`/api/tasks/${ids["First bug"]}`));
    expect(detail.task.activity.filter((a) => a.kind === "value" && a.data.dropped)).toHaveLength(
      2,
    );

    /* A ship that clears a dated Type leaves the task with no type. */
    await ok(mine.patch(`/api/properties/${type.id}`, { dated: true }));
    await ok(mine.patch(`/api/options/${bug}`, { targetAt: "2026-10-14" }));
    await ok(mine.post(`/api/options/${bug}/ship`, { rest: "clear" }));
    expect(await valuesOf("Second bug")).not.toHaveProperty(priority.id);
  });

  it("a rule written beside a create leaves the new task no hidden value", async () => {
    const { owner, mine, projectId, type, priority, bug, story, urgent } = await bugs(false);
    for (let round = 0; round < 3; round++) {
      await ok(mine.patch(`/api/properties/${priority.id}`, { when: null }));
      const [rule, ...made] = await Promise.all([
        mine.patch(`/api/properties/${priority.id}`, {
          when: { propertyId: type.id, optionIds: [bug] },
        }),
        ...[0, 1, 2, 3].map((n) =>
          mine.post(`/api/projects/${projectId}/tasks`, {
            title: `Story ${round}.${n}`,
            values: { [type.id]: story, [priority.id]: urgent },
          }),
        ),
      ]);
      expect(rule.ok).toBe(true);
      for (const answer of made) expect(answer.status).toBe(201);
      const tasks = (await board(owner, projectId)).tasks as {
        title: string;
        values: Record<string, unknown>;
      }[];
      const stories = tasks.filter((t) => t.title.startsWith(`Story ${round}.`));
      expect(stories).toHaveLength(4);
      for (const t of stories) expect(t.values).not.toHaveProperty(priority.id);
    }
  });
});

describe("A rule that closes a circle", () => {
  it("a clear that breaks a circle is counted before it drops", async () => {
    const { mine, type, area, values } = await circle();
    const count = await ok(
      mine.get(`/api/properties/${type.id}/count?when=${encodeURIComponent("null")}`),
    );
    expect(count).toEqual({ tasks: 1, names: ["Area", "Size"] });
    expect(await values()).toHaveProperty(area.id);
  });

  it("an option delete that breaks a circle drops what the rule it frees hides", async () => {
    const { mine, area, small, values } = await circle();
    await ok(mine.del(`/api/options/${small}`));
    expect(await values()).not.toHaveProperty(area.id);
  });

  it("a property delete that breaks a circle drops what the rule it frees hides", async () => {
    const { mine, area, size, values } = await circle();
    await ok(mine.del(`/api/properties/${size.id}`));
    expect(await values()).not.toHaveProperty(area.id);
  });
});
