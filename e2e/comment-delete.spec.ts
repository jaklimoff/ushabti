import { expect, test, type Browser } from "@playwright/test";
import {
  addTask,
  card,
  createProject,
  gotoSettings,
  inDatabase,
  register,
  unique,
} from "./helpers";

/**
 * An admin can take any comment down from the panel, and every delete asks
 * in place first, naming whose words go.
 */

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test("a member cannot delete somebody's comment, an admin can, and both are asked first", async ({
  browser,
}) => {
  const anna = await freshPage(browser);
  const ben = await freshPage(browser);
  await register(anna.page, "Anna Owner");
  const projectId = await createProject(anna.page, unique("Delete"));
  const benAccount = await register(ben.page, "Ben Friend");

  await gotoSettings(anna.page, projectId, "people");
  await anna.page.getByLabel("Email of the new member").fill(benAccount.email);
  await anna.page.getByRole("button", { name: "Add member" }).click();
  await expect(anna.page.getByText(benAccount.email)).toBeVisible();

  await anna.page.goto(`/p/${projectId}`);
  await addTask(anna.page, "Todo", "Talked about");
  await anna.page.getByTestId("comment-box").fill("Anna says hello");
  await anna.page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(anna.page.getByTestId("comment-markdown")).toHaveText("Anna says hello");

  /* Ben is a member: his own comment has a ✕, Anna's has none. */
  const panel = ben.page.getByTestId("task-panel");
  await ben.page.goto(`/p/${projectId}`);
  await card(ben.page, "Talked about").click();
  await panel.getByTestId("comment-box").fill("Ben says hi");
  await panel.getByRole("button", { name: "Comment", exact: true }).click();
  /* By place, not by words: a row that asks no longer shows its words. */
  const annas = panel.getByTestId("comment").nth(0);
  const bens = panel.getByTestId("comment").nth(1);
  await expect(bens).toBeVisible();
  await expect(bens.getByRole("button", { name: "Delete comment" })).toBeVisible();
  await expect(annas.getByRole("button", { name: /^Delete/ })).toHaveCount(0);

  /* His own delete asks too, and Cancel keeps the words. */
  await bens.getByRole("button", { name: "Delete comment" }).click();
  await expect(
    bens.getByRole("alertdialog", {
      name: "Delete this comment? Its words are gone for good.",
    }),
  ).toBeVisible();
  await bens.getByRole("button", { name: "Cancel" }).click();
  await expect(bens.getByTestId("comment-markdown")).toHaveText("Ben says hi");

  /* Made an admin, Ben sees a ✕ on Anna's comment. */
  await inDatabase((client) =>
    client.query(
      `UPDATE project_members SET role = 'admin'
         WHERE project_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)`,
      [projectId, benAccount.email],
    ),
  );
  await ben.page.reload();
  await card(ben.page, "Talked about").click();
  const remove = annas.getByRole("button", { name: "Delete Anna Owner's comment" });
  await expect(remove).toBeVisible();

  /* The ✕ asks, naming the author, and deletes nothing until answered. */
  await remove.click();
  const ask = annas.getByRole("alertdialog", {
    name: "Delete Anna Owner's comment? Its words are gone for good.",
  });
  await expect(ask).toBeVisible();
  await annas.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);
  await expect(annas.getByTestId("comment-markdown")).toHaveText("Anna says hello");

  await remove.click();
  await Promise.all([
    ben.page.waitForResponse(
      (r) => /\/api\/comments\/[0-9a-f-]+$/.test(r.url()) && r.request().method() === "DELETE",
    ),
    annas.getByRole("button", { name: "Yes, delete" }).click(),
  ]);
  await expect(panel.getByTestId("comment")).toHaveCount(1);
  await expect(panel.getByTestId("comment-markdown")).toHaveText("Ben says hi");

  /* The feed says who deleted whose comment, and not what it said. */
  await panel.getByRole("tab", { name: "Activity" }).click();
  await expect(panel.getByText("Ben Friend deleted Anna Owner's comment")).toBeVisible();
  await expect(panel.getByText("Anna says hello")).toHaveCount(0);

  await anna.context.close();
  await ben.context.close();
});
