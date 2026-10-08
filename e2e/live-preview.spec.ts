import { expect, test } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

/**
 * The description is a CodeMirror box, and its chunk is fetched as the panel
 * opens. Which chunk loads when needs the production build, so this one stays
 * end to end. What the box draws is `src/components/board/LiveEditor.test.tsx`.
 */

test.describe("The live description", () => {
  test("the editor is fetched when the panel opens, before the box is pressed", async ({
    page,
  }) => {
    await register(page);
    await createProject(page, unique("Early"));
    // The panel opens with the new task, and the editor's chunk comes with it.
    const fetched = page.waitForResponse(
      async (r) =>
        /\.js(\?|$)/.test(r.url()) && (await r.text().catch(() => "")).includes("cm-lp-task"),
    );
    await addTask(page, "Todo", "Fetched early");
    await expect(page.getByTestId("task-title")).toBeVisible();
    await fetched;
    // From here no script can arrive, so the box must already be here.
    await page.route(/\.js(\?|$)/, (route) => route.abort());
    await page.getByText("Add a description…").click();
    await expect(page.getByTestId("live-editor")).toBeFocused();
  });
});
