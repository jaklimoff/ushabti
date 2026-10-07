import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, inDatabase, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;

type Option = { id: string; name: string };
type Board = {
  project: { doneWhen: { propertyId: string; optionIds: string[] } | null };
  properties: { id: string; name: string; options: Option[] }[];
  views: { id: string; isDefault: boolean }[];
  tasks: { id: string; title: string; blockedBy: string[] }[];
  archived: { id: string }[];
};

/*
 * A project whose Status ends in two ways, Shipped and Won't do, and a task
 * that waits on another. Set up through the routes, because what is under
 * test is what the server calls over.
 */
async function twoEnds(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Done when"));
  const read = async (): Promise<Board> =>
    (await page.request.get(`/api/projects/${projectId}/board`)).json();

  let board = await read();
  const status = board.properties.find((p) => p.name === "Status")!;
  const added = await page.request.post(`/api/properties/${status.id}/options`, {
    data: { name: "Won't do" },
  });
  expect(added.ok()).toBeTruthy();
  board = await read();
  const options = board.properties.find((p) => p.id === status.id)!.options;
  const named = (name: string) => options.find((o) => o.name === name)!;
  const shipped = named("Shipped");
  const wont = named("Won't do");
  const backlog = named("Backlog");

  const made = async (title: string, values: Record<string, unknown> = {}) =>
    (
      await (
        await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title, values } })
      ).json()
    ).task.id as string;
  const blocker = await made("The blocker", { [status.id]: backlog.id });
  const waiting = await made("The waiting task", { [status.id]: backlog.id });
  const linked = await page.request.post(`/api/tasks/${waiting}/blockers`, {
    data: { blockerId: blocker },
  });
  expect(linked.ok()).toBeTruthy();

  const set = async (taskId: string, optionId: string) =>
    expect(
      (
        await page.request.put(`/api/tasks/${taskId}/values/${status.id}`, {
          data: { value: optionId },
        })
      ).ok(),
    ).toBeTruthy();
  const blocked = async () => (await read()).tasks.find((t) => t.id === waiting)!.blockedBy.length;
  const doneWhen = (data: unknown) =>
    page.request.patch(`/api/projects/${projectId}`, { data: { doneWhen: data } });

  return {
    projectId,
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

test.describe("Done when names more than one option", () => {
  test("a task in any picked option is over, so Won't do frees what waits on it", async ({
    page,
  }) => {
    const { read, status, shipped, wont, backlog, blocker, set, blocked, doneWhen } =
      await twoEnds(page);
    const saved = await doneWhen({ propertyId: status.id, optionIds: [wont.id, shipped.id] });
    expect(saved.ok()).toBeTruthy();
    /* The property's own order, whatever order the write named them in. */
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

  test("a project saved with one option still blocks and frees as before", async ({ page }) => {
    const { projectId, read, status, shipped, wont, backlog, blocker, set, blocked, doneWhen } =
      await twoEnds(page);
    /* The shape a release before the list wrote, put straight in the row. */
    await inDatabase((client) =>
      client.query(`update projects set done_when = $1::jsonb where id = $2`, [
        JSON.stringify({ propertyId: status.id, optionId: shipped.id }),
        projectId,
      ]),
    );
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

    /* A write in the old shape is still taken, as a list of one. */
    expect((await doneWhen({ propertyId: status.id, optionId: wont.id })).ok()).toBeTruthy();
    expect((await read()).project.doneWhen).toEqual({
      propertyId: status.id,
      optionIds: [wont.id],
    });
  });

  test("a write naming an option of another property is refused", async ({ page }) => {
    const { projectId, read, status, shipped, doneWhen } = await twoEnds(page);
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Version", type: "select", options: ["v1"] },
    });
    expect(made.ok()).toBeTruthy();
    const v1 = (await read()).properties.find((p) => p.name === "Version")!.options[0];

    const refused = await doneWhen({ propertyId: status.id, optionIds: [shipped.id, v1.id] });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toBe(
      "Every option of Done when has to be an option of Status.",
    );
    expect((await read()).project.doneWhen).toBeNull();
  });

  test("Ship archives tasks in every picked option", async ({ page }) => {
    const { projectId, read, status, shipped, wont, backlog, made, doneWhen } = await twoEnds(page);
    expect(
      (await doneWhen({ propertyId: status.id, optionIds: [shipped.id, wont.id] })).ok(),
    ).toBeTruthy();
    const version = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Version", type: "select", options: ["v1", "v2"] },
    });
    expect(version.ok()).toBeTruthy();
    const property = (await read()).properties.find((p) => p.name === "Version")!;
    const v1 = property.options[0];
    const dated = await page.request.patch(`/api/properties/${property.id}`, {
      data: { dated: true },
    });
    expect(dated.ok()).toBeTruthy();
    const due = await page.request.patch(`/api/options/${v1.id}`, {
      data: { targetAt: "2026-10-14" },
    });
    expect(due.ok()).toBeTruthy();

    const done = await made("Shipped work", { [property.id]: v1.id, [status.id]: shipped.id });
    const dropped = await made("Dropped work", { [property.id]: v1.id, [status.id]: wont.id });
    const open = await made("Open work", { [property.id]: v1.id, [status.id]: backlog.id });

    const ship = await page.request.post(`/api/options/${v1.id}/ship`, {
      data: { rest: "leave" },
    });
    expect(ship.ok(), await ship.text()).toBeTruthy();
    const board = await read();
    const archived = board.archived.map((t) => t.id);
    expect(archived).toContain(done);
    expect(archived).toContain(dropped);
    expect(archived).not.toContain(open);
    expect(board.tasks.map((t) => t.id)).toContain(open);
  });

  test("deleting one picked option leaves the rest working", async ({ page }) => {
    const { read, status, shipped, wont, backlog, blocker, set, blocked, doneWhen } =
      await twoEnds(page);
    expect(
      (await doneWhen({ propertyId: status.id, optionIds: [shipped.id, wont.id] })).ok(),
    ).toBeTruthy();
    expect((await page.request.delete(`/api/options/${wont.id}`)).ok()).toBeTruthy();

    expect((await read()).project.doneWhen).toEqual({
      propertyId: status.id,
      optionIds: [shipped.id],
    });
    expect(await blocked()).toBe(1);
    await set(blocker, shipped.id);
    expect(await blocked()).toBe(0);
    await set(blocker, backlog.id);
    expect(await blocked()).toBe(1);

    /* With none left, archived is the only word for over again. */
    expect((await page.request.delete(`/api/options/${shipped.id}`)).ok()).toBeTruthy();
    expect((await read()).project.doneWhen).toBeNull();
  });

  test("Settings picks the options with ticks", async ({ page }) => {
    const { projectId, read, status, shipped, wont } = await twoEnds(page);
    await gotoSettings(page, projectId, "project");

    const property = page.getByLabel("The property that says a task is done");
    await property.click();
    await page.getByRole("option", { name: "Status" }).click();
    const ticks = page.getByRole("group", { name: "The options that say a task is done" });
    const tick = (name: string) => ticks.getByRole("checkbox", { name, exact: true });
    await expect(ticks.getByRole("checkbox")).toHaveCount(6);

    await tick("Shipped").click();
    await expect(tick("Shipped")).toBeChecked();
    await expect(tick("Shipped")).toBeEnabled();
    await tick("Won't do").click();
    await expect(tick("Won't do")).toBeChecked();
    await expect(tick("Won't do")).toBeEnabled();
    await expect
      .poll(async () => (await read()).project.doneWhen)
      .toEqual({ propertyId: status.id, optionIds: [shipped.id, wont.id] });

    /* Taking every tick away leaves archived as the answer. */
    await tick("Shipped").click();
    await expect(tick("Shipped")).toBeEnabled();
    await tick("Won't do").click();
    await expect(tick("Won't do")).not.toBeChecked();
    await expect.poll(async () => (await read()).project.doneWhen).toBeNull();
  });
});
