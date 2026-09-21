import { expect, test } from "@playwright/test";
import { addFilter, addTask, card, createProject, register, settles, unique } from "./helpers";

type Page = import("@playwright/test").Page;

/** The key of the task whose panel is open. */
async function openKey(page: Page): Promise<string> {
  return (await page.getByTestId("task-key").innerText()).trim();
}

/** Adds a task, reads the key its panel shows, and closes the panel again. */
async function addAndKey(page: Page, title: string): Promise<string> {
  await addTask(page, "Todo", title);
  const key = await openKey(page);
  await page.getByRole("button", { name: "Close task" }).click();
  return key;
}

/** Says what the open task waits on, through the menu and the box. */
async function sayItWaitsOn(page: Page, key: string) {
  await page.getByRole("button", { name: "Task menu" }).click();
  await page.getByTestId("add-blocker").click();
  const box = page.getByTestId("link-search-blockedBy");
  await box.fill(key);
  await settles(page, /\/api\/tasks\/[0-9a-f-]+\/blockers$/, () => box.press("Enter"));
}

test.describe("What a task waits on", () => {
  test("a blocker puts a chain on the card, and being over takes it off", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Blocking"));

    const shipKey = await addAndKey(page, "Ship the thing");
    const wireKey = await addAndKey(page, "Wire the queue");

    /* Nothing at rest: a task with no links draws no heading at all, which is
       why the way in is the menu. */
    await card(page, "Ship the thing").click();
    await expect(page.getByTestId("task-links")).toHaveCount(0);

    await sayItWaitsOn(page, wireKey);

    await expect(page.getByTestId("links-blockedBy")).toBeVisible();
    await expect(page.getByTestId("link-row")).toContainText("Wire the queue");
    await page.getByRole("button", { name: "Close task" }).click();

    /* One glyph on the card, and nothing else: no list, no count. */
    await expect(card(page, "Ship the thing").getByTestId("card-chain")).toBeVisible();
    await expect(card(page, "Ship the thing").getByTestId("card-chain")).toHaveAttribute(
      "title",
      `Blocked by ${wireKey}`,
    );
    await expect(card(page, "Wire the queue").getByTestId("card-chain")).toHaveCount(0);

    /* The other end of the chain says so on the other task. */
    await card(page, "Wire the queue").click();
    await expect(page.getByTestId("links-blocks")).toBeVisible();
    await expect(page.getByTestId("links-blocks")).toContainText("Ship the thing");

    /* A circle is refused with one sentence, and nothing is written. */
    await sayItWaitsOn(page, shipKey);
    await expect(page.getByTestId("link-refused")).toHaveText(
      `${shipKey} already waits on ${wireKey}, so this would be a circle.`,
    );
    /* The box stayed open and nothing landed in the list under it. */
    await expect(page.getByTestId("links-blockedBy").getByTestId("link-row")).toHaveCount(0);
    await page.getByRole("button", { name: "Close task" }).click();

    /* "Blocked" is a rule like any other, and it is not a property: nobody
       added one and nothing writes one. */
    await addFilter(page, "Blocked", "Blocked");
    await expect(card(page, "Ship the thing")).toBeVisible();
    await expect(card(page, "Wire the queue")).toHaveCount(0);
    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
      page.getByRole("button", { name: "Remove the filter Blocked" }).click(),
    );
    await expect(card(page, "Wire the queue")).toBeVisible();

    /* Archived is what over means until the owner says otherwise, so the
       glyph goes without anybody touching the link. */
    await card(page, "Wire the queue").click();
    await page.getByRole("button", { name: "Task menu" }).click();
    await page.getByTestId("archive-task").click();
    await expect(page.getByTestId("archived-row")).toBeVisible();
    await page.getByRole("button", { name: "Close task" }).click();

    await expect(card(page, "Ship the thing")).toBeVisible();
    await expect(card(page, "Ship the thing").getByTestId("card-chain")).toHaveCount(0);

    /* The link is still there. It is over, not gone — struck through, and the
       ✕ that takes it away is where it always was. */
    await card(page, "Ship the thing").click();
    await expect(page.getByTestId("link-row")).toContainText("Wire the queue");
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/blockers\//, () =>
      page.getByRole("button", { name: `Unlink ${wireKey}` }).click(),
    );
    await expect(page.getByTestId("task-links")).toHaveCount(0);
  });

  test("a task cannot wait on itself", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Itself"));

    const key = await addAndKey(page, "Only task");
    await card(page, "Only task").click();

    await page.getByRole("button", { name: "Task menu" }).click();
    await page.getByTestId("add-blocker").click();
    const box = page.getByTestId("link-search-blockedBy");
    await box.fill(key);
    /* The task itself is never in the list, so there is nothing to press: the
       box says so rather than offering a row that would be refused. */
    await expect(page.getByTestId("links-blockedBy")).toContainText("No task by that name.");
  });
});
