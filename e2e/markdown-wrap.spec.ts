import { expect, test, type Locator } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

/**
 * A description is read far more often than it is edited. The editor wraps a
 * long line, so the rendered text has to wrap it too: a sideways scroll hides
 * the end of the line, and nothing on screen says there is more.
 */

const PATH = `src/app/api/projects/[projectId]/{agents,members,invites,webhooks,import}/${"x".repeat(60)}`;
const URL = `https://example.com/${"a-very-long-segment-".repeat(6)}end`;
const LONG = `const everything = [${Array.from({ length: 30 }, (_, i) => `"item${i}"`).join(", ")}];`;

const TEXT = `Look at \`${PATH}\` first.\n\nThen ${URL}\n\n\`\`\`\n${LONG}\n\`\`\``;

/** Every element inside `box` fits its own width, and the box fits its parent. */
async function nothingScrollsSideways(box: Locator) {
  const wide = await box.evaluate((root) => {
    const all = [root, ...Array.from(root.querySelectorAll("*"))];
    return all
      .filter((el) => el.scrollWidth > el.clientWidth && el.clientWidth > 0)
      .map((el) => `${el.tagName} ${el.scrollWidth}>${el.clientWidth}`);
  });
  expect(wide).toEqual([]);
  const [own, parent] = await box.evaluate((el) => [
    el.getBoundingClientRect().right,
    el.parentElement!.getBoundingClientRect().right,
  ]);
  expect(own).toBeLessThanOrEqual(parent + 0.5);
}

const WIDTHS = [
  { name: "on a desk", viewport: { width: 1280, height: 800 } },
  { name: "on a phone", viewport: { width: 390, height: 780 } },
];

for (const { name, viewport } of WIDTHS) {
  test.describe(`A long line in markdown ${name}`, () => {
    test.use({ viewport });

    test("wraps in a description and a comment", async ({ page }) => {
      await register(page);
      await createProject(page, unique("Wrap"));
      await addTask(page, "Todo", "Long lines");
      await expect(page.getByTestId("task-panel")).toBeVisible();

      await page.getByText("Add a description…").click();
      const editor = page.getByPlaceholder("Write in markdown…");
      await editor.fill(TEXT);
      await editor.blur();

      const description = page.getByTestId("markdown");
      await expect(description.locator("pre code")).toContainText('"item29"');
      await expect(description.locator("p code")).toContainText("webhooks,import");
      await nothingScrollsSideways(description);
      // The block is taller than one line, because the line wrapped.
      const pre = await description.locator("pre").boundingBox();
      expect(pre!.height).toBeGreaterThan(50);

      await page.getByPlaceholder("Leave a note…").fill(TEXT);
      await page.getByRole("button", { name: "Comment", exact: true }).click();
      const comment = page.getByTestId("comment-markdown");
      await expect(comment.locator("a")).toContainText("example.com");
      await nothingScrollsSideways(comment);
    });
  });
}
