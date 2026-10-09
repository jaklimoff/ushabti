import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, board, ok, person, project, task } = await import("@/test/route");

/*
 * What a task waits on and what it is part of, as the server keeps them. The
 * chain on a card is the board read's `blockedBy`, being over takes a link out
 * of it, one level deep is the parent route's rule, and the count a parent
 * carries is worked out by the board read. The screens that draw these are
 * `TaskLinks.test.tsx`.
 */

type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  tasks: {
    id: string;
    key: string;
    title: string;
    blockedBy: string[];
    parts: { done: number; total: number } | null;
  }[];
};
type Link = { id: string; key: string; over: boolean };

describe("What a task waits on", () => {
  /* The server half of `e2e/blockers.spec.ts` "a blocker puts a chain on the
     card, and being over takes it off". The panel and the card are in
     `TaskLinks.test.tsx` under the same name. */
  it("a blocker puts a chain on the card, and being over takes it off", async () => {
    const me = await person();
    const p = await project(me);
    const r = api(me);
    const ship = await task(me, p.id, "Ship the thing");
    const wire = await task(me, p.id, "Wire the queue");
    const plumb = await task(me, p.id, "Plumb the drain");
    const read = async () => (await board(me, p.id)) as Board;
    const chainOf = async (id: string) => (await read()).tasks.find((t) => t.id === id)!.blockedBy;
    const detail = async (id: string) =>
      (
        await ok<{ task: { links: { blockedBy: Link[]; blocks: Link[] } } }>(
          r.get(`/api/tasks/${id}`),
        )
      ).task;

    expect(await chainOf(ship.id)).toEqual([]);
    await ok(r.post(`/api/tasks/${ship.id}/blockers`, { blockerId: wire.id }));
    expect(await chainOf(ship.id)).toEqual([wire.key]);
    expect(await chainOf(plumb.id)).toEqual([]);

    /* The other end of the chain says so on the other task. */
    expect((await detail(wire.id)).links.blocks).toMatchObject([{ id: ship.id, over: false }]);
    expect((await detail(ship.id)).links.blockedBy).toMatchObject([{ id: wire.id, over: false }]);

    await ok(r.post(`/api/tasks/${wire.id}/blockers`, { blockerId: plumb.id }));

    /* A circle is refused with one sentence, and nothing is written. */
    const circle = await r.post(`/api/tasks/${plumb.id}/blockers`, { blockerId: ship.id });
    expect(circle.status).toBe(409);
    expect((await circle.json()).error).toBe(
      `${ship.key} already waits on ${plumb.key}, so this would be a circle.`,
    );
    expect((await detail(plumb.id)).links.blockedBy).toEqual([]);
    expect(await chainOf(plumb.id)).toEqual([]);

    /* Archived is what over means until the owner says otherwise, so the
       chain goes without anybody touching the link. */
    await ok(r.post(`/api/tasks/${wire.id}/archive`));
    expect(await chainOf(ship.id)).toEqual([]);

    /* The link is still there. It is over, not gone, and the ✕ takes it away. */
    expect((await detail(ship.id)).links.blockedBy).toMatchObject([{ id: wire.id, over: true }]);
    await ok(r.del(`/api/tasks/${ship.id}/blockers/${wire.id}`));
    expect((await detail(ship.id)).links.blockedBy).toEqual([]);
  });
});

describe("What a task is part of", () => {
  /* It was `e2e/parents.spec.ts`, and called the routes there too. */
  it("an agent sets, replaces and removes a parent, and the server holds one level", async () => {
    const owner = await person("Parts Owner");
    const p = await project(owner);
    for (const title of ["Epic A", "Epic B", "Child", "Loose"]) await task(owner, p.id, title);
    const bot = await agent(owner, p.id, "Splitter");
    const r = bot.api;

    const board = (await ok(r.get(`/api/projects/${p.id}/board`))) as Board;
    const byTitle = (title: string) => board.tasks.find((t) => t.title === title)!;
    const [epicA, epicB, part, lone] = ["Epic A", "Epic B", "Child", "Loose"].map(byTitle);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- read field by field, as the e2e test did.
    const detail = async (id: string) => (await ok<{ task: any }>(r.get(`/api/tasks/${id}`))).task;
    const ids = (list: { id: string }[]) => list.map((t) => t.id);

    expect((await r.put(`/api/tasks/${part.id}/parent`, { parentId: epicA.id })).status).toBe(200);
    expect((await detail(part.id)).parent).toMatchObject({
      id: epicA.id,
      key: epicA.key,
      over: false,
    });
    expect(ids((await detail(epicA.id)).children)).toEqual([part.id]);
    /* A part is not a blocker, on the board or in the detail. */
    expect((await detail(part.id)).blockedBy).toEqual([]);
    expect((await detail(part.id)).links.blockedBy).toEqual([]);
    expect((await detail(epicA.id)).links.blocks).toEqual([]);

    /* A second PUT replaces: one parent at most. */
    const moved = await r.put(`/api/tasks/${part.id}/parent`, { parentId: epicB.id });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ ok: true, left: epicA.key });
    expect((await detail(part.id)).parent.id).toBe(epicB.id);
    expect((await detail(epicA.id)).children).toEqual([]);
    expect(ids((await detail(epicB.id)).children)).toEqual([part.id]);

    const links = async (id: string) =>
      ((await detail(id)).activity as { kind: string; data: unknown }[]).filter(
        (l) => l.kind === "link",
      );
    expect((await links(part.id))[0].data).toMatchObject({
      action: "parented",
      parentKey: epicB.key,
    });

    /* One level, refused with 409 and a sentence each time. */
    const refused = async (answer: Promise<Response>) => {
      const res = await answer;
      return [res.status, ((await res.json()) as { error: string }).error];
    };
    expect(await refused(r.put(`/api/tasks/${lone.id}/parent`, { parentId: lone.id }))).toEqual([
      409,
      "A task cannot be part of itself.",
    ]);
    expect(await refused(r.put(`/api/tasks/${lone.id}/parent`, { parentId: part.id }))).toEqual([
      409,
      `${part.key} is part of ${epicB.key}, so it cannot have parts of its own.`,
    ]);
    expect(await refused(r.put(`/api/tasks/${epicB.id}/parent`, { parentId: epicA.id }))).toEqual([
      409,
      `${epicB.key} has parts of its own, so it cannot be part of another task.`,
    ]);

    /* Archive keeps the link, and the archived part reads as over. */
    expect((await r.post(`/api/tasks/${part.id}/archive`)).status).toBe(200);
    expect((await detail(epicB.id)).children).toMatchObject([{ id: part.id, over: true }]);
    expect((await detail(part.id)).parent).toMatchObject({ id: epicB.id, over: false });

    expect((await r.del(`/api/tasks/${part.id}/parent`)).status).toBe(200);
    expect((await detail(part.id)).parent).toBeNull();
    expect((await detail(epicB.id)).children).toEqual([]);
    expect((await links(part.id))[0].data).toMatchObject({
      action: "unparented",
      parentKey: epicB.key,
    });

    /* A deleted parent is off the board, so its row refuses nothing. */
    expect((await r.put(`/api/tasks/${lone.id}/parent`, { parentId: epicA.id })).status).toBe(200);
    expect((await api(owner).del(`/api/tasks/${epicA.id}`)).status).toBe(200);
    expect((await detail(lone.id)).parent).toBeNull();
    expect((await r.put(`/api/tasks/${epicB.id}/parent`, { parentId: lone.id })).status).toBe(200);

    /* Put back, the parent would make a second level, so the part leaves it. */
    expect((await api(owner).post(`/api/tasks/${epicA.id}/restore`)).status).toBe(200);
    expect((await detail(lone.id)).parent).toBeNull();
    expect((await detail(epicA.id)).children).toEqual([]);
    expect(ids((await detail(lone.id)).children)).toEqual([epicB.id]);
    expect((await links(lone.id))[0].data).toMatchObject({
      action: "unparented",
      parentKey: epicA.key,
    });
  });

  /* The server half of `e2e/parents.spec.ts` "a parent says how many of its
     parts are done, on the card, in the list and in the panel". The card, the
     list and the panel are in `TaskLinks.test.tsx` under the same name. */
  it("a parent says how many of its parts are done, on the card, in the list and in the panel", async () => {
    const me = await person();
    const p = await project(me);
    const r = api(me);
    const read = async () => (await board(me, p.id)) as Board;
    const status = (await read()).properties.find((x) => x.name === "Status")!;
    const done = status.options.find((o) => o.name === "Shipped")!;
    const backlog = status.options.find((o) => o.name === "Backlog")!;
    await ok(
      r.patch(`/api/projects/${p.id}`, { doneWhen: { propertyId: status.id, optionId: done.id } }),
    );

    const made = async (title: string, optionId: string) =>
      (
        await ok<{ task: { id: string; key: string } }>(
          r.post(`/api/projects/${p.id}/tasks`, { title, values: { [status.id]: optionId } }),
        )
      ).task;
    const epic = await made("The epic", backlog.id);
    const lone = await made("A lone task", backlog.id);
    const parts: string[] = [];
    for (const [title, optionId] of [
      ["Part A", done.id],
      ["Part B", done.id],
      ["Part C", backlog.id],
      ["Part D", backlog.id],
      ["Part E", backlog.id],
    ]) {
      const { id } = await made(title, optionId);
      await ok(r.put(`/api/tasks/${id}/parent`, { parentId: epic.id }));
      parts.push(id);
    }
    const partsOf = async (id: string) => (await read()).tasks.find((t) => t.id === id)!.parts;

    /* Archived counts as done, as it does for a blocker. */
    await ok(r.post(`/api/tasks/${parts[2]}/archive`));
    expect(await partsOf(epic.id)).toEqual({ done: 3, total: 5 });
    expect(await partsOf(lone.id)).toBeNull();

    /* A part moved to done changes the parent's count at the next read. */
    await ok(r.put(`/api/tasks/${parts[3]}/values/${status.id}`, { value: done.id }));
    expect(await partsOf(epic.id)).toEqual({ done: 4, total: 5 });

    await ok(r.post(`/api/tasks/${parts[4]}/archive`));
    expect(await partsOf(epic.id)).toEqual({ done: 5, total: 5 });

    /* A deleted part is not counted at all. */
    await ok(r.del(`/api/tasks/${parts[1]}`));
    expect(await partsOf(epic.id)).toEqual({ done: 4, total: 4 });

    /* A part added joins the count. */
    await ok(r.put(`/api/tasks/${lone.id}/parent`, { parentId: epic.id }));
    expect(await partsOf(epic.id)).toEqual({ done: 4, total: 5 });
  });
});
