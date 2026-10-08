import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  addTask,
  card,
  createProject,
  gotoSettings,
  register,
  unique,
  descriptionBox,
} from "./helpers";

/*
 * A field says who else is typing in it, and blocks nobody. It rides on the
 * presence a tab already sends: the field is one more word in it. Two names
 * on one field and the line on a phone are
 * `src/components/board/EditingSign.test.tsx`.
 */

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

async function addMember(owner: Page, projectId: string, email: string) {
  await gotoSettings(owner, projectId, "people");
  await owner.getByLabel("Email of the new member").fill(email);
  await owner.getByRole("button", { name: "Add member" }).click();
  await expect(owner.getByText(email)).toBeVisible();
}

async function openTask(page: Page, projectId: string, title: string) {
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("live-dot")).toBeVisible();
  await card(page, title).click();
  await expect(page.getByTestId("task-key")).toBeVisible();
}

const sign = (page: Page) => page.getByTestId("editing-sign");

test.describe("A field shows who is editing it", () => {
  test("the title, the description and one checklist item each carry the sign", async ({
    browser,
  }) => {
    const anna = await freshPage(browser);
    const ben = await freshPage(browser);

    await register(anna.page, "Anna Person");
    const projectId = await createProject(anna.page, unique("Editing"));
    const benAccount = await register(ben.page, "Ben Person");
    await addMember(anna.page, projectId, benAccount.email);

    await anna.page.goto(`/p/${projectId}`);
    await addTask(anna.page, "Todo", "Written by two");
    // The box stays open after Enter, ready for the next item.
    await anna.page.getByRole("button", { name: "Add item" }).click();
    for (const text of ["First item", "Second item"]) {
      await anna.page.getByPlaceholder("What has to be true?").fill(text);
      await anna.page.keyboard.press("Enter");
      await expect(anna.page.getByRole("button", { name: text, exact: true })).toBeVisible();
    }
    await anna.page.keyboard.press("Escape");
    await anna.page.getByRole("button", { name: "Close task" }).click();

    await openTask(anna.page, projectId, "Written by two");
    await openTask(ben.page, projectId, "Written by two");
    await expect(ben.page.getByTestId("panel-present-face")).toHaveCount(1, { timeout: 2_000 });

    // The title. Anna only puts the cursor in it; that is enough.
    await anna.page.getByTestId("task-title").click();
    await expect(sign(ben.page)).toHaveText("Anna Person is editing the title", {
      timeout: 2_000,
    });
    await expect(sign(anna.page)).toHaveCount(0);

    // Ben can still type and save while the sign shows.
    const benTitle = ben.page.getByTestId("task-title");
    await expect(benTitle).toBeEnabled();
    await benTitle.fill("Written by Ben");
    await benTitle.press("Enter");
    await expect(anna.page.getByTestId("task-title")).toHaveValue("Written by Ben");
    await expect(sign(ben.page)).toHaveText("Anna Person is editing the title");

    // Escape leaves the title, and the sign goes with it.
    await anna.page.getByTestId("task-title").press("Escape");
    await expect(sign(ben.page)).toHaveCount(0, { timeout: 2_000 });

    // The description, opened by a click and closed by Escape.
    await anna.page.getByText("Add a description…").click();
    await expect(sign(ben.page)).toHaveText("Anna Person is editing the description", {
      timeout: 2_000,
    });
    await descriptionBox(anna.page).press("Escape");
    await expect(sign(ben.page)).toHaveCount(0, { timeout: 2_000 });

    // One checklist item, and only that item.
    await anna.page.getByRole("button", { name: "Second item", exact: true }).click();
    await expect(sign(ben.page)).toHaveCount(1, { timeout: 2_000 });
    await expect(sign(ben.page)).toHaveText("Anna Person is editing this item");
    await expect(sign(ben.page).locator("xpath=preceding-sibling::div[1]")).toContainText(
      "Second item",
    );
    await anna.page.keyboard.press("Enter");
    await expect(sign(ben.page)).toHaveCount(0, { timeout: 2_000 });

    await anna.context.close();
    await ben.context.close();
  });
});
