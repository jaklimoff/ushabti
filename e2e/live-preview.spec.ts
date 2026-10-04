import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addTask,
  boxValue,
  createProject,
  expectBoxValue,
  fillBox,
  gotoSettings,
  register,
  unique,
} from "./helpers";

/**
 * The description is a CodeMirror box whose lines read as rendered markdown,
 * except the lines the cursor is on. The words it holds are markdown and
 * nothing else.
 */

const AGENT = "Night Builder";

async function openDescription(page: Page, agent = true) {
  await register(page, "Ada Lovelace");
  const projectId = await createProject(page, unique("Live"));
  if (agent) {
    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill(AGENT);
    await page.getByRole("button", { name: "Add agent" }).click();
    await expect(page.getByTestId("agent-box").filter({ hasText: AGENT })).toBeVisible();
    await page.goto(`/p/${projectId}`);
  }
  await addTask(page, "Todo", "Write it live");
  await page.getByText("Add a description…").click();
  const editor = page.getByTestId("live-editor");
  await expect(editor).toBeFocused();
  return editor;
}

/* The upload routes, answered here: this proves where the box writes the
   line, which needs no bucket. `upload.spec.ts` runs the real thing where one
   is set. */
async function stubUploads(page: Page) {
  const id = crypto.randomUUID();
  await page.route(/\/api\/tasks\/[0-9a-f-]+\/attachments$/, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { id, uploadUrl: "/stub-bucket", headers: {} } })
      : route.fallback(),
  );
  await page.route("**/stub-bucket", (route) => route.fulfill({ status: 200 }));
  await page.route(`**/api/attachments/${id}/ready`, (route) =>
    route.fulfill({
      json: {
        attachment: {
          id,
          taskId: "t",
          uploaderId: null,
          name: "pixel.png",
          mime: "image/png",
          size: 70,
          width: 1,
          height: 1,
          createdAt: new Date().toISOString(),
          url: `/api/attachments/${id}`,
        },
      },
    }),
  );
  return `![pixel.png](/api/attachments/${id})`;
}

async function hand(page: Page, editor: Locator, how: "drop" | "paste") {
  const files = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3])], "pixel.png", { type: "image/png" }));
    return dt;
  });
  if (how === "drop") await editor.dispatchEvent("drop", { dataTransfer: files });
  else
    await editor.evaluate((el, dt) => {
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, files);
}

test.describe("The live description", () => {
  test("hides the marks on every line but the cursor's", async ({ page }) => {
    const editor = await openDescription(page);
    await editor.pressSequentially("## Plan");
    await editor.press("Enter");
    await editor.pressSequentially("**bold** and ~gone~ and `code`");
    await editor.press("Enter");
    await editor.pressSequentially("- [ ] open item");
    await editor.press("Enter");
    await editor.press("Enter");

    // The cursor is on the last, empty line, so every line above reads rendered.
    await expect(editor).toContainText("Plan");
    await expect(editor).not.toContainText("##");
    await expect(editor).not.toContainText("**");
    await expect(editor).not.toContainText("~");
    await expect(editor.locator(".cm-lp-strong")).toHaveText("bold");
    await expect(editor.locator(".cm-lp-strike")).toHaveText("gone");
    await expect(editor.locator(".cm-lp-code")).toHaveText("code");

    // A tick writes the words.
    const box = editor.locator(".cm-lp-task");
    await expect(box).not.toBeChecked();
    await box.click();
    await expect(editor.locator(".cm-lp-task")).toBeChecked();

    // Back on the heading, its marks come back.
    await editor.press("ControlOrMeta+Home");
    await expect(editor.locator(".cm-line").first()).toHaveText("## Plan");

    await editor.press("ControlOrMeta+Enter");
    await expect(page.getByTestId("markdown")).toContainText("bold and gone and code");
    await expect(page.getByTestId("markdown").locator("del")).toHaveText("gone");
    await expect(page.getByTestId("markdown").locator("input[type=checkbox]")).toBeChecked();
  });

  test("a selection across lines shows the marks of every line in it", async ({ page }) => {
    const editor = await openDescription(page, false);
    await fillBox(editor, "**one**\n**two**\n**three**\n");
    await expect(editor.locator(".cm-line")).toHaveText(["one", "two", "three", ""]);
    await editor.press("ControlOrMeta+Home");
    await editor.press("Shift+ArrowDown");
    await expect(editor.locator(".cm-line")).toHaveText(["**one**", "**two**", "three", ""]);
  });

  test("a key of a known task reads as a link, as the page draws it", async ({ page }) => {
    const editor = await openDescription(page, false);
    const key = await page.getByTestId("task-key").innerText();
    await fillBox(editor, `Waits on ${key} and \`${key}\`\n`);
    const link = editor.locator("[data-task-key]");
    await expect(link).toHaveText(key);
    await expect(link).toHaveClass(/cm-lp-link/);
    await editor.blur();
    await expect(page.getByTestId("markdown").locator("a[data-task-key]")).toHaveText(key);
  });

  test("the @ list works inside it, with the same keys", async ({ page }) => {
    const editor = await openDescription(page);
    await editor.pressSequentially("Over to @nig");
    await expect(page.getByTestId("mention-list")).toBeVisible();
    await editor.press("Escape");
    await expect(page.getByTestId("mention-list")).toBeHidden();
    // Escape closed the list and nothing else.
    await expect(editor).toBeVisible();
    await editor.pressSequentially("h");
    await editor.press("Backspace");
    await expect(page.getByTestId("mention-list")).toBeVisible();
    await editor.press("Enter");
    await expect(page.getByTestId("mention-list")).toBeHidden();
    await expect(editor).toHaveText(`Over to @${AGENT} `);
    await editor.pressSequentially("today");
    await expect(editor).toHaveText(`Over to @${AGENT} today`);
    await editor.blur();
    await expect(page.getByTestId("markdown")).toContainText(`Over to @${AGENT} today`);
  });

  test("Escape throws the edit away and leaves the panel open", async ({ page }) => {
    const editor = await openDescription(page, false);
    await editor.pressSequentially("not kept");
    await editor.press("Escape");
    await expect(editor).toBeHidden();
    await expect(page.getByTestId("task-title")).toBeVisible();
    await expect(page.getByText("Add a description…")).toBeVisible();
  });

  for (const how of ["drop", "paste"] as const) {
    test(`a file handed in by ${how} writes its line at the cursor`, async ({ page }) => {
      const editor = await openDescription(page, false);
      const line = await stubUploads(page);
      await fillBox(editor, "first line\nlast line");
      // The caret goes to the end of the first line.
      await editor.press("ControlOrMeta+Home");
      await editor.press("End");
      await hand(page, editor, how);
      await expectBoxValue(editor, `first line\n${line}\nlast line`);
      // The caret is after the line, so typing goes on from there.
      await editor.press("Enter");
      await editor.pressSequentially("typed after");
      expect(await boxValue(editor)).toBe(`first line\n${line}\ntyped after\nlast line`);
    });
  }

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

test.describe("The live description on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("typing scrolls nothing sideways, and the caret stays on the screen", async ({ page }) => {
    const editor = await openDescription(page, false);
    const long = "https://example.com/" + "a-very-long-path-segment/".repeat(12);
    for (let i = 0; i < 25; i++) {
      await editor.pressSequentially(i === 3 ? long : `line ${i} of a long description`);
      await editor.press("Enter");
    }
    await editor.pressSequentially("the end");
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sideways).toBe(0);
    const caret = await page.evaluate(() => {
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    });
    expect(caret.top).toBeGreaterThanOrEqual(0);
    expect(caret.bottom).toBeLessThanOrEqual(844);
    expect(caret.left).toBeGreaterThanOrEqual(0);
    expect(caret.right).toBeLessThanOrEqual(390);
  });
});
