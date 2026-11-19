import { expect, test } from "@playwright/test";
import { addTask, card, createProject, register, unique } from "./helpers";

/*
 * A link in a Links field is fixed where it sits, with the pencil beside its
 * ✕. The keys, the refusals and what is written are
 * `src/components/board/Links.test.tsx`; this is the screen, saved for real.
 */

const PR = "https://github.com/acme/shop/pull/12";
const TYPO = "https://github.com/acme/shop/pull/21";
const ISSUE = "https://github.com/acme/shop/issues/7";

test("a link is edited in place and keeps its place", async ({ page }, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Links"));
  await addTask(page, "Todo", "Ship the cart");
  await page.getByRole("button", { name: "Close task" }).click();

  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Pull requests", type: "link" },
  });
  expect(made.ok()).toBe(true);
  type Board = {
    properties: { id: string; name: string }[];
    tasks: { id: string; title: string }[];
  };
  const board: Board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const links = board.properties.find((p) => p.name === "Pull requests")!;
  const task = board.tasks.find((t) => t.title === "Ship the cart")!;
  const put = await page.request.put(`/api/tasks/${task.id}/values/${links.id}`, {
    data: { value: [TYPO, ISSUE] },
  });
  expect(put.ok()).toBe(true);

  await page.goto(`/p/${projectId}`);
  await card(page, "Ship the cart").click();
  const group = page.getByRole("group", { name: "Pull requests" });
  await expect(group.getByRole("link")).toHaveText(["acme/shop#21", "acme/shop#7"]);

  await page.getByRole("button", { name: "Edit acme/shop#21" }).click();
  const box = page.getByRole("textbox", { name: "Edit acme/shop#21" });
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(TYPO);
  await page.screenshot({ path: testInfo.outputPath("seen-link-editing.png") });

  const saved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/values/${links.id}`),
  );
  await box.fill(PR);
  await box.press("Enter");
  expect((await saved).ok()).toBe(true);
  await expect(group.getByRole("link")).toHaveText(["acme/shop#12", "acme/shop#7"]);

  await page.reload();
  await expect(page.getByRole("group", { name: "Pull requests" }).getByRole("link")).toHaveText([
    "acme/shop#12",
    "acme/shop#7",
  ]);
  await page.screenshot({ path: testInfo.outputPath("seen-link-edited.png") });
});
