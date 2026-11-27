import { expect, test } from "@playwright/test";
import { addTask, card, createProject, register, unique } from "./helpers";

/*
 * A number box that is handed words keeps them and says why, rather than
 * clearing the value it held. What is sent and what is not is
 * `src/components/board/TaskPanel.test.tsx`; this is the screen, for real.
 */

test("a number box refuses 1,5 and says so under itself", async ({ page }, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Numbers"));
  await addTask(page, "Todo", "Size the cart");
  await page.getByRole("button", { name: "Close task" }).click();

  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Points", type: "number" },
  });
  expect(made.ok()).toBe(true);
  type Board = {
    properties: { id: string; name: string }[];
    tasks: { id: string; title: string }[];
  };
  const board: Board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const points = board.properties.find((p) => p.name === "Points")!;
  const task = board.tasks.find((t) => t.title === "Size the cart")!;
  const put = await page.request.put(`/api/tasks/${task.id}/values/${points.id}`, {
    data: { value: 3 },
  });
  expect(put.ok()).toBe(true);

  await page.goto(`/p/${projectId}`);
  await card(page, "Size the cart").click();
  const box = page.getByTestId("task-panel").getByRole("textbox", { name: "Points" });
  await expect(box).toHaveValue("3");

  let sent = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes(`/values/${points.id}`)) sent += 1;
  });
  await box.fill("1,5");
  await box.press("Tab");
  const said = page.getByRole("alert").filter({ hasText: "Points takes a number" });
  await expect(said).toHaveText("Points takes a number, like 2 or 1.5.");
  await expect(box).toHaveValue("1,5");
  await expect(box).toHaveAttribute("aria-invalid", "true");
  await page.screenshot({ path: testInfo.outputPath("seen-number-refused.png") });
  expect(sent).toBe(0);

  await page.reload();
  await card(page, "Size the cart").click();
  await expect(page.getByTestId("task-panel").getByRole("textbox", { name: "Points" })).toHaveValue(
    "3",
  );
});
