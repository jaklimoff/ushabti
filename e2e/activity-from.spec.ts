import { expect, test } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

/* USH-468: the Activity tab says what a title or a value was before. */
test("a rename and a new value say what they were before", async ({ page }, testInfo) => {
  await register(page, "Jack");
  await createProject(page, unique("History"));
  await addTask(page, "Todo", "queue thing");
  await expect(page.getByRole("tab", { name: /^Comments/ })).toBeVisible();

  const title = page.getByTestId("task-title");
  await title.click();
  await title.fill("Retries stop after five tries");
  await title.press("Enter");

  await page.getByRole("button", { name: "Urgent" }).click();
  await page.getByRole("button", { name: "High" }).click();

  await page.getByRole("tab", { name: /^Activity/ }).click();
  await expect(
    page.getByText("Jack renamed it from “queue thing” to “Retries stop after five tries”"),
  ).toBeVisible();
  await expect(page.getByText("Jack set Priority from empty to Urgent")).toBeVisible();
  await expect(page.getByText("Jack set Priority from Urgent to High")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("seen-activity-from.png") });
});
