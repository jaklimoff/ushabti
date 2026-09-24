import { expect, test } from "@playwright/test";
import {
  addTask,
  card,
  column,
  confirmDelete,
  createProject,
  forAFinger,
  gotoSettings,
  overflow,
  register,
  settles,
  unique,
} from "./helpers";

type Page = import("@playwright/test").Page;

/** Archives the task whose panel is open, from the panel menu. */
async function archiveOpenTask(page: Page) {
  await page.getByRole("button", { name: "Task menu" }).click();
  await page.getByTestId("archive-task").click();
  await expect(page.getByTestId("archived-row")).toBeVisible();
}

/** The panel's own read of one task, which is the only GET of that shape. */
function detailRead(url: string): boolean {
  return /\/api\/tasks\/[0-9a-f-]+$/.test(new URL(url).pathname);
}

/*
 * A read the panel throws away changes nothing on screen, so there is no event
 * to wait for. This counts the answers the page has parsed instead. The count
 * goes up in the same chain of microtasks that hands the answer to the panel,
 * so a poll that sees the count has seen the panel decide. A count beats an
 * event here, because an event needs a listener that is already in place when
 * the answer lands, and the answer may land first. The wrap belongs to the
 * test; the panel carries no hook for one.
 */
async function countDetailReads(page: Page) {
  await page.addInitScript(() => {
    const counter = window as unknown as { __detailReads: number };
    counter.__detailReads = 0;
    const json = Response.prototype.json;
    Response.prototype.json = async function (this: Response) {
      const parsed: unknown = await json.call(this);
      if (/\/api\/tasks\/[0-9a-f-]+$/.test(this.url)) counter.__detailReads += 1;
      return parsed;
    };
  });
}

const detailReads = (page: Page) =>
  page.evaluate(() => (window as unknown as { __detailReads: number }).__detailReads);

/** Waits until the page has parsed a detail read it had not parsed at `seen`. */
const detailReadPast = (page: Page, seen: number) =>
  page.waitForFunction(
    (before) => (window as unknown as { __detailReads: number }).__detailReads > before,
    seen,
  );

/*
 * The Priority row of the open panel. Four short options are drawn as a row of
 * buttons, and the one that holds the answer offers to clear it instead of
 * naming itself.
 */
function priority(page: Page, name: string) {
  return page
    .getByTestId("task-panel")
    .locator('[data-property="Priority"]')
    .getByRole("button", { name, exact: true });
}

test.describe("Archiving a task", () => {
  test("archives from the panel, keeps the history, and puts it back", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Archive"));

    await addTask(page, "Todo", "Ship the release image");
    const comment = page.getByPlaceholder("Leave a note…");
    await comment.fill("The image builds.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByRole("tab", { name: /^Comments 1/ })).toBeVisible();

    await archiveOpenTask(page);

    // The card is off the board, and the panel says why it is.
    await expect(card(page, "Ship the release image")).toHaveCount(0);
    await expect(page.getByTestId("archived-row")).toContainText("Archived just now");

    // Everything on the task is still there.
    await expect(page.getByRole("tab", { name: /^Comments 1/ })).toBeVisible();
    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect(page.getByText(/archived the task/)).toBeVisible();

    await page.getByRole("button", { name: "Put back", exact: true }).click();
    await expect(page.getByTestId("archived-row")).toHaveCount(0);
    await expect(card(page, "Ship the release image").first()).toBeVisible();

    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect(page.getByText(/put the task back/)).toBeVisible();

    // It survives a reload, on both sides of the change.
    await page.reload();
    await expect(card(page, "Ship the release image").first()).toBeVisible();
  });

  test("archives everything in a column, after a question that names the count", async ({
    page,
  }) => {
    await register(page);
    await createProject(page, unique("Sweep"));

    for (const title of ["First shipped", "Second shipped"]) {
      await addTask(page, "Shipped", title);
      await page.getByRole("button", { name: "Close task" }).click();
    }
    await addTask(page, "Todo", "Still to do");
    await page.getByRole("button", { name: "Close task" }).click();

    await expect(column(page, "Shipped").getByTestId("column-count")).toHaveText("2");

    await page.getByRole("button", { name: "Archive everything in Shipped" }).click();
    const question = page.getByTestId("column-confirm");
    await expect(question).toContainText("Archive 2 tasks in Shipped?");
    await expect(question).toContainText("They leave the board and keep their history.");

    // Cancel leaves the column alone.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(column(page, "Shipped").getByTestId("column-count")).toHaveText("2");

    await page.getByRole("button", { name: "Archive everything in Shipped" }).click();
    await confirmDelete(page, /^Yes, archive$/);

    await expect(column(page, "Shipped").getByTestId("card")).toHaveCount(0);
    await expect(card(page, "Still to do").first()).toBeVisible();
    // The board says how many went, in the server's own number.
    await expect(page.getByTestId("toast")).toContainText("Archived 2 tasks");

    /* An empty column is not proof of an archive: a delete would leave the
       same board. So find one of them, see the word on its row, open it, and
       read its own history. */
    await page.getByTestId("search-box").fill("first shipped");
    const hit = page.getByTestId("search-hit").first();
    await expect(hit).toContainText("First shipped");
    await expect(hit).toContainText("archived");
    await hit.click();

    await expect(page.getByTestId("archived-row")).toBeVisible();
    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect(page.getByText(/archived the task/)).toBeVisible();

    // And it comes back where it was.
    await page.getByRole("button", { name: "Put back", exact: true }).click();
    await expect(card(page, "First shipped").first()).toBeVisible();
    await expect(column(page, "Shipped").getByTestId("column-count")).toHaveText("1");

    await page.reload();
    await expect(column(page, "Shipped").getByTestId("column-count")).toHaveText("1");
  });

  test("a search still finds an archived task, says so, and its link opens it", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Finding"));

    await addTask(page, "Todo", "Rate limit the sign-in route");
    const key = await page.getByTestId("task-key").innerText();
    await archiveOpenTask(page);
    await page.getByRole("button", { name: "Close task" }).click();

    const box = page.getByTestId("search-box");
    await box.fill("rate limit");
    const hit = page.getByTestId("search-hit").first();
    await expect(hit).toContainText("Rate limit the sign-in route");
    await expect(hit).toContainText("archived");

    await hit.click();
    await expect(page.getByTestId("task-title")).toHaveValue("Rate limit the sign-in route");
    await expect(page.getByTestId("archived-row")).toBeVisible();

    // The link a person pastes into a chat opens the panel, with no card
    // behind it.
    await page.goto(`/p/${projectId}?task=${key}`);
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(page.getByTestId("task-title")).toHaveValue("Rate limit the sign-in route");
    await expect(page.getByTestId("archived-row")).toBeVisible();
    await expect(page.getByTestId("card")).toHaveCount(0);
  });

  /*
   * A link to an archived task opens a panel with no card behind it. The key,
   * the title and the archived row come from the board's own archived list, so
   * they are on screen before the panel's own read of the task lands. It used
   * to draw nothing at all until then.
   */
  test("a link to an archived task draws its head before the detail lands", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Pasted"));

    await addTask(page, "Todo", "Rotate the signing key");
    const key = await page.getByTestId("task-key").innerText();
    await archiveOpenTask(page);

    /* Hold back the one read the panel makes for itself, and let it go when
       the assertions have run. A fixed delay is a race the assertions have to
       win, and a slow runner loses it for the wrong reason. What is left on
       the screen meanwhile is what the board already knew. */
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/tasks/*", async (route) => {
      await held;
      await route.continue();
    });

    await page.goto(`/p/${projectId}?task=${key}`);

    // The read is still out: the panel says so, and the head is already there.
    await expect(page.getByTestId("panel-loading")).toBeVisible();
    await expect(page.getByTestId("task-key")).toHaveText(key);
    await expect(page.getByTestId("task-title")).toHaveValue("Rotate the signing key");
    await expect(page.getByTestId("archived-row")).toBeVisible();

    // Then the rest of the task arrives, and no card is drawn behind it.
    release();
    await expect(page.getByTestId("panel-loading")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^Comments/ })).toBeVisible();
    await expect(page.getByTestId("card")).toHaveCount(0);
  });

  /*
   * An archived task has no card, so the panel draws its values from its own
   * read of the task. A change was saved and then drawn from the answer that
   * went out before it, so it snapped back and read as a click that failed.
   */
  test("a property changed on an archived task stays on screen", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Keeps"));

    await addTask(page, "Todo", "Rotate the backup key");
    const key = await page.getByTestId("task-key").innerText();
    await archiveOpenTask(page);

    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+$/, () =>
      priority(page, "High").click(),
    );
    await expect(priority(page, "High")).toHaveAttribute("title", "Click to clear");

    // And it was saved, which is the half that always worked.
    await page.goto(`/p/${projectId}?task=${key}`);
    await expect(priority(page, "High")).toHaveAttribute("title", "Click to clear");
  });

  /*
   * The panel draws a value before the server has taken it, and on an archived
   * task the panel is the only place it is drawn. A refused write left the
   * value that was thrown away on screen, and only reopening the panel
   * corrected it.
   */
  test("a refused value write on an archived task draws the old value again", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Refused"));

    await addTask(page, "Todo", "Rotate the backup key");
    await archiveOpenTask(page);

    // The value the server really holds.
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+$/, () =>
      priority(page, "Low").click(),
    );
    await expect(priority(page, "Low")).toHaveAttribute("title", "Click to clear");

    await page.route("**/api/tasks/*/values/*", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "The change did not save." }),
      });
    });

    await priority(page, "High").click();

    // The refusal is told, which is the half that always worked.
    await expect(page.getByTestId("toast")).toContainText("The change did not save.");

    // And the panel draws what the server holds, not what was clicked.
    await expect(priority(page, "Low")).toHaveAttribute("title", "Click to clear");
    await expect(priority(page, "High")).toHaveAttribute("title", "High");
  });

  /*
   * The panel counts its own writes and throws away a read of the task that
   * one of them overtook. A write it hands to the store counts the same: on an
   * archived task the values are drawn from that read, so an answer that went
   * out before the write would put the old value back.
   */
  test("a read the panel's own write overtook is thrown away", async ({ page }) => {
    await countDetailReads(page);
    await register(page);
    await createProject(page, unique("Overtaken"));

    await addTask(page, "Todo", "Rotate the signing key");
    await archiveOpenTask(page);

    /* The first read is copied, the second is held. Holding it is not enough
       on its own: released, the server would answer with the write already in
       it. So the held one answers with the copy, which is the task as it was. */
    let stale = "";
    let arrived = () => {};
    let release = () => {};
    const second = new Promise<void>((resolve) => (arrived = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;

    await page.route("**/api/tasks/*", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      reads += 1;
      if (reads === 1) {
        const answer = await route.fetch();
        stale = await answer.text();
        return route.fulfill({ response: answer, body: stale });
      }
      /* The panel reads again for the one it threw away. That read is real. */
      if (reads > 2) return route.fallback();
      arrived();
      await held;
      return route.fulfill({ contentType: "application/json", body: stale });
    });

    /* A broadcast is what starts a read the panel did not ask for. */
    const ring = () =>
      page.evaluate(() => window.dispatchEvent(new CustomEvent("ushabti:remote-change")));
    const copied = page.waitForResponse((r) => detailRead(r.url()));
    await ring();
    await copied;
    await ring();
    await second;

    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+$/, () =>
      priority(page, "High").click(),
    );
    await expect(priority(page, "High")).toHaveAttribute("title", "Click to clear");

    /* The headers are one barrier, and they are not enough: the panel has
       still to parse the body and decide what to do with it. The count says
       it has. */
    const parsed = await detailReads(page);
    const landed = page.waitForResponse((r) => detailRead(r.url()));
    release();
    await landed;
    await detailReadPast(page, parsed);

    // The old answer landed and was thrown away.
    await expect(priority(page, "High")).toHaveAttribute("title", "Click to clear");
  });

  /*
   * A value picked while Archive was still on its way went off the panel. The
   * read Archive ends with went out while the value was still on its way, was
   * answered before the server took the value, and was drawn. Nothing read
   * the task again, so the value stayed off until the panel was opened again.
   */
  test("a value picked while Archive is on its way stays on screen", async ({ page }) => {
    await countDetailReads(page);
    await register(page);
    await createProject(page, unique("Crossed"));
    await addTask(page, "Todo", "Rotate the backup key");
    /* Archive is a write too, so a first read of the task still on its way
       would wait for it, and the archived panel has nothing to draw values
       from until then. The first read lands before the test goes on. */
    await detailReadPast(page, 0);

    /* Archive is done on the server but answered only when the test says. */
    let answerArchive = () => {};
    const archiveHeld = new Promise<void>((resolve) => (answerArchive = resolve));
    await page.route("**/api/tasks/*/archive", async (route) => {
      const answer = await route.fetch();
      await archiveHeld;
      await route.fulfill({ response: answer });
    });

    /* The value reaches the server only after the read Archive starts has
       been answered and parsed, so that answer is from before the value. */
    let sendValue = () => {};
    const valueHeld = new Promise<void>((resolve) => (sendValue = resolve));
    await page.route("**/api/tasks/*/values/*", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      await valueHeld;
      await route.fallback();
    });

    await page.getByRole("button", { name: "Task menu" }).click();
    await page.getByTestId("archive-task").click();
    await expect(page.getByTestId("archived-row")).toBeVisible();

    const valueOut = page.waitForRequest((r) => r.method() === "PUT" && /\/values\//.test(r.url()));
    await priority(page, "High").click();
    await valueOut;

    const parsed = await detailReads(page);
    answerArchive();
    await detailReadPast(page, parsed);

    const saved = page.waitForResponse(
      (r) => r.request().method() === "PUT" && /\/values\//.test(r.url()),
    );
    sendValue();
    await saved;

    // The read that crossed the value was thrown away, and the value stays.
    await expect(priority(page, "High")).toHaveAttribute("title", "Click to clear");
  });

  /*
   * The cascade behind a delete does not care whether a task is on a board, so
   * a question that counted only the cards would name half the cost.
   */
  test("the cost of a delete counts the archived tasks too", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Cost"));

    for (const title of ["Live estimate", "Archived estimate"]) {
      await addTask(page, "Todo", title);
      await page.getByRole("button", { name: "XL", exact: true }).click();
      if (title === "Archived estimate") await archiveOpenTask(page);
      await page.getByRole("button", { name: "Close task" }).click();
    }

    // One card left on the board, two values in the project.
    await expect(page.getByTestId("card")).toHaveCount(1);

    await gotoSettings(page, projectId);
    await page.getByRole("button", { name: "Delete the property Estimate" }).click();
    await expect(
      page.getByText("Delete Estimate? 5 options and 2 values go with it."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // And the key rename counts them as well, because it renames them too.
    await gotoSettings(page, projectId, "project");
    await page.getByLabel("Project key", { exact: true }).fill("ZZZ");
    await expect(page.getByText(/2 tasks are called .*today/)).toBeVisible();
  });

  /*
   * The page a team opens to see what is in the drawer. It draws the archived
   * tasks the browser already carries, so it asks the server nothing until
   * somebody puts one back.
   */
  test("the archive page lists what went, newest first, and puts one back", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Drawer"));

    for (const title of ["First to go", "Second to go"]) {
      await addTask(page, "Todo", title);
      await archiveOpenTask(page);
      await page.getByRole("button", { name: "Close task" }).click();
    }
    await addTask(page, "Todo", "Still on the board");
    await page.getByRole("button", { name: "Close task" }).click();

    // The way in is the top bar, beside Settings. The archive is not a view.
    await page.getByRole("link", { name: "Archived", exact: true }).click();
    await page.waitForURL(`**/p/${projectId}/archived`);

    const rows = page.getByTestId("archive-row");
    await expect(rows).toHaveCount(2);
    await expect(page.getByText("2 archived tasks")).toBeVisible();

    // Newest archived first, and only the archived ones.
    await expect(rows.nth(0)).toContainText("Second to go");
    await expect(rows.nth(0)).toContainText("Archived just now");
    await expect(rows.nth(1)).toContainText("First to go");
    await expect(page.getByText("Still on the board")).toHaveCount(0);

    // The box narrows the list by key and title, and nothing else moves.
    const find = page.getByTestId("archive-find");
    await find.fill("first");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("First to go");
    await find.fill("nothing by that name");
    await expect(page.getByText("No archived task by those words.")).toBeVisible();
    await find.fill("");
    await expect(rows).toHaveCount(2);

    // A row opens the task, exactly as its link does.
    await rows.nth(1).getByRole("link").click();
    await expect(page.getByTestId("task-title")).toHaveValue("First to go");
    await expect(page.getByTestId("archived-row")).toBeVisible();
    await page.goBack();

    // One press, and it is back where it was.
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/archive$/, () =>
      rows.filter({ hasText: "First to go" }).getByTestId("archive-put-back").click(),
    );
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Second to go");
    await expect(page.getByTestId("toast")).toContainText("is back on the board");

    await page.getByRole("link", { name: "Back to board" }).click();
    await expect(card(page, "First to go").first()).toBeVisible();
    await expect(card(page, "Second to go")).toHaveCount(0);
  });
});

/*
 * A comment goes straight to its route, past the store, and the panel did not
 * watch it. A read of the task that went out while the comment was on its way
 * could answer from before it and be drawn, which took the comments already
 * on screen off the panel until the comment was answered.
 */
test.describe("A read that crosses a write", () => {
  test("a read that crossed a comment on its way is thrown away", async ({ page }) => {
    await countDetailReads(page);
    await register(page);
    await createProject(page, unique("Crossing"));
    await addTask(page, "Todo", "Rotate the backup key");
    await page.getByRole("tab", { name: /^Comments/ }).click();

    /* The first read the test starts is copied: the task before any comment.
       The second answers with that copy, which is a read from before the
       comment that follows. Every other read is real. */
    let stale = "";
    let step: "copy" | "real" | "stale" = "copy";
    await page.route("**/api/tasks/*", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      if (step === "copy") {
        step = "real";
        const answer = await route.fetch();
        stale = await answer.text();
        return route.fulfill({ response: answer, body: stale });
      }
      if (step === "stale") {
        step = "real";
        return route.fulfill({ contentType: "application/json", body: stale });
      }
      return route.fallback();
    });
    const ring = () =>
      page.evaluate(() => window.dispatchEvent(new CustomEvent("ushabti:remote-change")));
    const copied = page.waitForResponse((r) => detailRead(r.url()));
    await ring();
    await copied;

    const comment = (text: string) => page.getByTestId("comment").filter({ hasText: text });
    const box = page.getByTestId("comment-box");
    await box.fill("The old key goes on Friday.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(comment("The old key goes on Friday.")).toBeVisible();

    /* The next comment is held on its way, and a read goes out meanwhile. */
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/tasks/*/comments", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await held;
      return route.fallback();
    });
    const out = page.waitForRequest((r) => r.method() === "POST" && /\/comments$/.test(r.url()));
    await box.fill("The new key is in the vault.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await out;

    step = "stale";
    const parsed = await detailReads(page);
    await ring();
    await detailReadPast(page, parsed);

    // The read that crossed the comment was thrown away.
    await expect(comment("The old key goes on Friday.")).toBeVisible();

    release();
    await expect(comment("The new key is in the vault.")).toBeVisible();
    await expect(comment("The old key goes on Friday.")).toBeVisible();
  });
});

test.describe("The archive on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("the archive page fits the screen, and every way back is pressable", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Pocket"));

    for (const title of [
      "A short one",
      "A title long enough to need the whole of a small screen",
    ]) {
      await addTask(page, "Todo", title);
      await archiveOpenTask(page);
      await page.getByRole("button", { name: "Close task" }).click();
    }

    // The way in is on the screen at this width too.
    await page.getByRole("link", { name: "Archived", exact: true }).click();
    await page.waitForURL(`**/p/${projectId}/archived`);
    await expect(page.getByTestId("archive-row")).toHaveCount(2);

    expect(await overflow(page)).toBe(0);
    await forAFinger(page.getByRole("button", { name: /^Put .* back$/ }), 2);
  });
});
