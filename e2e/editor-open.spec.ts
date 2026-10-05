import { expect, test, type Page, type Response } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

/**
 * The description's editor is a chunk of its own. The panel asks for it as it
 * opens, so a click after that draws the editor at once, with no stand-in in
 * between. A click before it still opens the editor, after the wait.
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

/* Watches the page from the press on: whether the stand-in was ever drawn,
   and how long the editor took to appear. Measured inside the page, so the
   round trips of the test runner do not count. */
async function watchOpen(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      opened: { pressedAt: number; shownAt: number | null; waited: boolean };
    };
    w.opened = { pressedAt: 0, shownAt: null, waited: false };
    document.addEventListener(
      "pointerdown",
      () => {
        w.opened.pressedAt = performance.now();
      },
      { capture: true, once: true },
    );
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="live-editor-wait"]')) w.opened.waited = true;
      if (w.opened.shownAt === null && document.querySelector('[data-testid="live-editor"]'))
        w.opened.shownAt = performance.now();
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () =>
    page.evaluate(() => {
      const { opened } = window as unknown as {
        opened: { pressedAt: number; shownAt: number; waited: boolean };
      };
      return { waited: opened.waited, took: opened.shownAt - opened.pressedAt };
    });
}

test("with the chunk loaded, the description opens at once and with no stand-in", async ({
  page,
}) => {
  await register(page, "Ada Lovelace");
  await createProject(page, unique("Open"));
  const chunk = editorChunk(page);
  await addTask(page, "Todo", "Open it at once");
  await chunk;

  const read = await watchOpen(page);
  await page.getByText("Add a description…").click();
  await expect(page.getByTestId("live-editor")).toBeFocused();
  const { waited, took } = await read();
  expect(waited).toBe(false);
  expect(took).toBeLessThan(100);
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
  await page.getByText("Add a description…").click();
  await expect(page.getByTestId("live-editor-wait")).toBeAttached();
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
