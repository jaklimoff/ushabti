import { expect, test, type Page, type Response } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

/**
 * The description's editor is a chunk of its own, and the description is
 * always its editor. The panel asks for the chunk as it opens, so a task
 * opened after that draws the editor at once, with no stand-in in between.
 * Before it, the box draws the words, and a click on them still ends in the
 * editor, after the wait.
 */

/* A string from CodeMirror's own theme. Nothing of ours writes it in a
   script, so a script that carries it carries CodeMirror. */
const CODEMIRROR = "cm-scroller";

/* Resolves with the first script that carries CodeMirror. */
function editorChunk(page: Page) {
  return new Promise<Response>((resolve) => {
    page.on("response", async (res) => {
      if (res.request().resourceType() !== "script") return;
      const body = await res.text().catch(() => "");
      if (body.includes(CODEMIRROR)) resolve(res);
    });
  });
}

/* Watches the page from the press on: whether the stand-in was ever drawn.
   Measured inside the page, so a stand-in drawn for one frame counts. */
async function watchOpen(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      opened: { waited: boolean };
    };
    w.opened = { waited: false };
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="live-editor-wait"]')) w.opened.waited = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () =>
    page.evaluate(() => (window as unknown as { opened: { waited: boolean } }).opened.waited);
}

test("with the chunk loaded, a task opens on its editor with no stand-in", async ({ page }) => {
  await register(page, "Ada Lovelace");
  await createProject(page, unique("Open"));
  const chunk = editorChunk(page);
  await addTask(page, "Todo", "Opened first");
  await chunk;
  await addTask(page, "Todo", "Opened second");
  await expect(page.getByTestId("task-title")).toHaveValue("Opened second");

  const waited = await watchOpen(page);
  await page.getByTestId("card").filter({ hasText: "Opened first" }).click();
  await expect(page.getByTestId("task-title")).toHaveValue("Opened first");
  await expect(page.getByTestId("live-editor")).toBeVisible();
  // There is no Click to edit: the box is the editor from the start.
  await expect(page.getByText("Click to edit")).toHaveCount(0);
  await page.getByTestId("live-editor").click();
  await expect(page.getByTestId("live-editor")).toBeFocused();
  expect(await waited()).toBe(false);
});

test("a click before the chunk has loaded still opens the editor", async ({ page }) => {
  await register(page, "Ada Lovelace");
  const projectId = await createProject(page, unique("Early"));
  await addTask(page, "Todo", "Open it early");

  /* A fresh page has none of the chunk yet. Once the board is drawn, every
     script is held until the click is in, so the chunk cannot beat it. */
  await page.goto(`/p/${projectId}`);
  await expect(page.getByText("Open it early").first()).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/_next/static/**/*.js", async (route) => {
    await held;
    await route.fallback();
  });
  await page.getByText("Open it early").first().click();
  // The box stands in for the editor, with the same words in it.
  const waiting = page.getByTestId("live-editor-wait");
  await expect(waiting).toHaveText("Add a description…");
  await waiting.click();
  release();
  await expect(page.getByTestId("live-editor")).toBeFocused();
});

test("the board's first load carries no CodeMirror", async ({ page }) => {
  await register(page, "Ada Lovelace");
  const projectId = await createProject(page, unique("Light"));
  await addTask(page, "Todo", "Keep it light");

  const scripts: Promise<string>[] = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") scripts.push(res.text().catch(() => ""));
  });
  await page.goto(`/p/${projectId}`);
  await expect(page.getByText("Keep it light").first()).toBeVisible();
  await page.waitForLoadState("load");
  const bodies = await Promise.all(scripts);
  expect(bodies.length).toBeGreaterThan(0);
  expect(bodies.filter((b) => b.includes(CODEMIRROR))).toHaveLength(0);

  /* The same reading does find it once a panel asks: the check above is not
     blind. */
  const chunk = editorChunk(page);
  await page.getByText("Keep it light").first().click();
  await chunk;
});
