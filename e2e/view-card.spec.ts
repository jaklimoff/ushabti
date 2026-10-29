import { expect, test } from "@playwright/test";
import {
  addListView,
  addTask,
  card,
  column,
  createProject,
  inDatabase,
  listHead,
  register,
  unique,
} from "./helpers";

/*
 * A view nobody arranged a card for reads the project's card for what it is.
 * The rule itself is unit tested in `src/lib/__tests__/card-view.test.ts`;
 * this file proves the screens draw it and that opening a view writes nothing.
 */
test.describe("A view with no card of its own", () => {
  test("a second board leaves its own columns off, and a list shows Status", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Follow"));
    await addTask(page, "Todo", "Sized once");
    await page
      .locator('[data-property="Estimate"]')
      .getByRole("button", { name: "M", exact: true })
      .click();
    await page.getByRole("button", { name: "Close task" }).click();

    const estimate = card(page, "Sized once").locator(
      '[data-testid="card-chip"][title^="Estimate"]',
    );
    await expect(estimate).toHaveCount(1);

    const estimateId = await inDatabase(async (client) => {
      const { rows } = await client.query(
        "select id from properties where project_id = $1 and name = 'Estimate'",
        [projectId],
      );
      return rows[0].id as string;
    });
    const made = await page.request.post(`/api/projects/${projectId}/views`, {
      data: { name: "By size", kind: "board", groupById: estimateId },
    });
    expect(made.status()).toBe(201);

    const writes: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "GET" && /card-view/.test(req.url())) writes.push(req.url());
    });

    await page.reload();
    await page.getByTestId("view-pill").filter({ hasText: "By size" }).click();
    await expect(column(page, "M")).toBeVisible();
    // The column already says M, so the card does not say it again.
    await expect(card(page, "Sized once")).toBeVisible();
    await expect(estimate).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("seen-second-board.png") });

    // A list has no columns, so the main board's columns come back as one.
    await addListView(page, "Rows");
    await expect(listHead(page, "Status")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-list-status.png") });

    expect(writes).toEqual([]);
    const copies = await inDatabase(async (client) => {
      const { rows } = await client.query(
        "select count(*)::int as n from views where project_id = $1 and card_view is not null",
        [projectId],
      );
      return rows[0].n as number;
    });
    expect(copies).toBe(0);
  });
});
