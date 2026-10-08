import { expect, test } from "@playwright/test";
import {
  addListView,
  addTask,
  column,
  createProject,
  listHead,
  listOrder,
  listRow,
  register,
  settles,
  unique,
} from "./helpers";

/*
 * What a list draws, and what a key or a heading sends, are component tests
 * in `src/components/board/List.test.tsx`. What stays here needs the server:
 * a drag the board sees, and an order that holds across a reload.
 */

/** The board this file works on: three tasks, in a known order. */
async function threeTasks(page: import("@playwright/test").Page) {
  await addTask(page, "Todo", "First thing");
  await page.getByRole("button", { name: "Close task" }).click();
  await addTask(page, "Todo", "Second thing");
  await page.getByRole("button", { name: "Close task" }).click();
  await addTask(page, "Backlog", "Third thing");
  await page.getByRole("button", { name: "Close task" }).click();
}

test.describe("A list view", () => {
  test(
    "shows every task the board shows, in the one order they share",
    { tag: "@smoke" },
    async ({ page }) => {
      await register(page);
      await createProject(page, unique("List"));
      await threeTasks(page);

      await addListView(page, "Everything");

      // The columns are gone; the rows are all here, in the board's own order.
      await expect(page.getByTestId("column")).toHaveCount(0);
      expect(await listOrder(page)).toEqual(["First thing", "Second thing", "Third thing"]);
      await expect(page.getByTestId("task-count")).toHaveText("3 tasks");
    },
  );

  test("moves a row, and the board sees the same order", { tag: "@smoke" }, async ({ page }) => {
    await register(page);
    await createProject(page, unique("Order"));
    await threeTasks(page);
    await addListView(page, "Order");

    const third = listRow(page, "Third thing");
    const first = listRow(page, "First thing");
    const from = await third.boundingBox();
    const to = await first.boundingBox();

    await page.mouse.move(from!.x + 200, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(from!.x + 208, from!.y + from!.height / 2 - 6, { steps: 5 });
    for (let i = 1; i <= 18; i += 1) {
      await page.mouse.move(
        from!.x + 200,
        from!.y + from!.height / 2 + ((to!.y - from!.y) * i) / 18,
      );
    }
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/move$/, () => page.mouse.up());

    expect(await listOrder(page)).toEqual(["Third thing", "First thing", "Second thing"]);

    // One order, shared by every view. The board is the proof.
    await page.reload();
    await expect(page.getByTestId("list-view")).toBeVisible();
    expect(await listOrder(page)).toEqual(["Third thing", "First thing", "Second thing"]);

    await page.getByTestId("view-pill").filter({ hasText: "Board" }).click();
    const todo = column(page, "Todo").getByTestId("card-title");
    await expect(todo).toHaveText(["First thing", "Second thing"]);
  });

  test(
    "orders itself by a column, and gives the board's own order back",
    { tag: "@smoke" },
    async ({ page }) => {
      await register(page);
      await createProject(page, unique("Sort"));

      await addTask(page, "Todo", "Middling");
      await page.getByRole("button", { name: "Medium", exact: true }).click();
      await page.getByRole("button", { name: "Close task" }).click();
      await addTask(page, "Todo", "The worst of it");
      await page.getByRole("button", { name: "Urgent", exact: true }).click();
      await page.getByRole("button", { name: "Close task" }).click();
      await addTask(page, "Todo", "Can wait");
      await page.getByRole("button", { name: "Low", exact: true }).click();
      await page.getByRole("button", { name: "Close task" }).click();

      await addListView(page, "Sorted");
      const asAdded = ["Middling", "The worst of it", "Can wait"];
      expect(await listOrder(page)).toEqual(asAdded);

      // Options are ordered by hand and that order is the meaning: Urgent above
      // Low, not alphabetically.
      await settles(page, /\/api\/views\//, () => listHead(page, "Priority").click());
      expect(await listOrder(page)).toEqual(["The worst of it", "Middling", "Can wait"]);

      await settles(page, /\/api\/views\//, () => listHead(page, "Priority").click());
      expect(await listOrder(page)).toEqual(["Can wait", "Middling", "The worst of it"]);

      // The third press is the way back to the order a drag can write.
      await settles(page, /\/api\/views\//, () => listHead(page, "Priority").click());
      expect(await listOrder(page)).toEqual(asAdded);
      await expect(page.getByTestId("sort-chip")).toHaveCount(0);
    },
  );

  test("holds its order across a reload, and says it is holding one", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Holds"));
    await threeTasks(page);
    await addListView(page, "Held");

    await settles(page, /\/api\/views\//, () => listHead(page, "Title").click());
    const sorted = await listOrder(page);
    expect(sorted).toEqual(["First thing", "Second thing", "Third thing"].sort());

    await expect(page.getByTestId("sort-chip")).toContainText("Title");

    await page.reload();
    await expect(page.getByTestId("list-view")).toBeVisible();
    expect(await listOrder(page)).toEqual(sorted);
    await expect(page.getByTestId("sort-chip")).toContainText("Title");

    // The chip is the other way out, and it leaves the drag working again.
    await settles(page, /\/api\/views\//, () => page.getByTestId("sort-clear").click());
    await expect(page.getByTestId("sort-chip")).toHaveCount(0);
    expect(await listOrder(page)).toEqual(["First thing", "Second thing", "Third thing"]);
  });
});
