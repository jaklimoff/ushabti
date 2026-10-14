import { expect, test, type Locator, type Page } from "@playwright/test";
import { card, column, createProject, dragCard, register, unique } from "./helpers";

/**
 * A shipped sprint leaves every screen that offers a choice, and stays on the
 * tasks that hold it. A shipped version stays everywhere: there are few, and
 * people pick old ones on purpose.
 *
 * The board, the picker, the filter fold and Settings are the two
 * `Sprints.test.tsx`. What stays is the drop, which is a drag across columns.
 */

type Option = { id: string; name: string };
type Board = {
  properties: { id: string; name: string; options: Option[] }[];
  views: { id: string; isDefault: boolean }[];
  tasks: { title: string; values: Record<string, unknown> }[];
};

async function board(page: Page, projectId: string): Promise<Board> {
  return (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as Board;
}

/** A property with three options whose first one has shipped. */
async function shippedFirst(page: Page, projectId: string, name: string, type: string) {
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name, type, options: [`${name[0]}1`, `${name[0]}2`, `${name[0]}3`] },
  });
  expect(made.status()).toBe(201);
  const property = (await board(page, projectId)).properties.find((p) => p.name === name)!;
  if (type === "select") {
    const dated = await page.request.patch(`/api/properties/${property.id}`, {
      data: { dated: true },
    });
    expect(dated.ok()).toBeTruthy();
  }
  /* Only an option with a target date can ship. */
  const targeted = await page.request.patch(`/api/options/${property.options[0].id}`, {
    data: { targetAt: new Date().toISOString().slice(0, 10) },
  });
  expect(targeted.ok()).toBeTruthy();
  const shipped = await page.request.post(`/api/options/${property.options[0].id}/ship`, {
    data: { rest: "leave" },
  });
  expect(shipped.ok()).toBeTruthy();
  return property;
}

async function addTaskWith(page: Page, projectId: string, title: string, values: object) {
  const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title, values },
  });
  expect(res.ok()).toBeTruthy();
}

/** A board grouped by a sprint whose S1 shipped: two cards on S1, one on S2. */
async function sprintBoard(page: Page, name: string) {
  await register(page);
  const projectId = await createProject(page, unique(name));
  const sprint = await shippedFirst(page, projectId, "Sprint", "iteration");
  const [s1, s2] = sprint.options;
  await addTaskWith(page, projectId, "Old one", { [sprint.id]: s1.id });
  await addTaskWith(page, projectId, "Old two", { [sprint.id]: s1.id });
  await addTaskWith(page, projectId, "Open work", { [sprint.id]: s2.id });
  const main = (await board(page, projectId)).views.find((v) => v.isDefault)!;
  const grouped = await page.request.patch(`/api/views/${main.id}`, {
    data: { groupById: sprint.id },
  });
  expect(grouped.ok()).toBeTruthy();
  return { projectId, sprint, s1, s2, viewId: main.id };
}

/* The board reads itself again as it opens, so a card can be drawn anew in
   the moment its box is asked. Wait until it holds still. */
async function boxOf(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("The card is not on the page");
  return box;
}

async function sprintOf(page: Page, projectId: string, sprintId: string, title: string) {
  const task = (await board(page, projectId)).tasks.find((t) => t.title === title)!;
  return task.values[sprintId] ?? null;
}

test("under a filter that no sprint fails, No open sprint takes no drop and no new task", async ({
  page,
}) => {
  const { projectId, sprint, s1, s2, viewId } = await sprintBoard(page, "Shipped refuse");
  const filtered = await page.request.patch(`/api/views/${viewId}`, {
    data: { filters: { rules: [{ propertyId: sprint.id, op: "is", values: [s1.id, s2.id] }] } },
  });
  expect(filtered.ok()).toBeTruthy();
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("column-name")).toHaveText([/^S2$/i, /^no open sprint$/i]);
  const none = column(page, "No open sprint");
  await expect(none.getByTestId("card")).toHaveCount(2);

  /* No composer: a task written here would have no sprint and vanish. */
  await expect(none.getByRole("button", { name: /^Add a task/ })).toHaveCount(0);
  await expect(column(page, "S2").getByRole("button", { name: /^Add a task/ })).toHaveCount(2);
  /* `n` on a card of the column opens the composer in the first one that takes a task. */
  await card(page, "Old one").focus();
  await page.keyboard.press("n");
  await expect(column(page, "S2").getByRole("textbox")).toBeVisible();
  await page.keyboard.press("Escape");

  /* A card from S2 is not let in, and nothing is written. */
  const into = await boxOf(none.getByTestId("card").last());
  await dragCard(
    page,
    "Open work",
    { x: into.x + into.width / 2, y: into.y + into.height + 20 },
    null,
  );
  await expect(column(page, "S2").getByTestId("card")).toHaveText([/Open work/]);
  await expect(none.getByTestId("card")).toHaveCount(2);
  expect(await sprintOf(page, projectId, sprint.id, "Open work")).toBe(s2.id);

  /* A shipped card still moves inside the column and out of it. */
  const above = await boxOf(card(page, "Old one"));
  await dragCard(page, "Old two", { x: above.x + above.width / 2, y: above.y + 4 });
  await expect(none.getByTestId("card")).toHaveText([/Old two/, /Old one/]);
  expect(await sprintOf(page, projectId, sprint.id, "Old two")).toBe(s1.id);

  const s2Box = await boxOf(column(page, "S2").getByTestId("card").first());
  await dragCard(page, "Old one", { x: s2Box.x + s2Box.width / 2, y: s2Box.y + s2Box.height + 20 });
  await expect(column(page, "S2").getByTestId("card")).toHaveCount(2);
  expect(await sprintOf(page, projectId, sprint.id, "Old one")).toBe(s2.id);
});
