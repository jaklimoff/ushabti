import { expect, test } from "@playwright/test";
import { addTask, createProject, fillBox, register, unique } from "./helpers";

/**
 * A link drawn in the description's box opens with a plain click, and the
 * caret stays where it was. Each case is `LiveLinks.test.tsx`; this one sees
 * it on the production build.
 */
test("a click on a link in the description opens it, and a key opens its task", async ({
  page,
  context,
}, testInfo) => {
  await context.route("https://example.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Outside</p>" }),
  );
  await register(page);
  await createProject(page, unique("Links"));
  await addTask(page, "Todo", "Pointed at");
  const first = (await page.getByTestId("task-key").textContent())!.trim();
  await addTask(page, "Todo", "Points out");
  await expect(page.getByTestId("task-title")).toHaveValue("Points out");

  await page.getByText("Add a description…").click();
  const editor = page.getByTestId("live-editor");
  await fillBox(editor, `Read [the docs](https://example.com/docs) and ${first}.\nlast line`);
  const docs = editor.locator("[data-lp-open]", { hasText: "the docs" });
  await expect(docs).toBeVisible();
  await expect(docs).toHaveCSS("cursor", "pointer");
  await page.screenshot({ path: testInfo.outputPath("seen-live-links.png") });

  const tab = context.waitForEvent("page");
  await docs.click();
  expect((await tab).url()).toBe("https://example.com/docs");
  // The caret stayed on the last line, so the link still reads as words.
  await expect(editor).not.toContainText("](");

  await editor.locator("[data-lp-open]", { hasText: first }).click();
  await expect(page.getByTestId("task-title")).toHaveValue("Pointed at");
});
