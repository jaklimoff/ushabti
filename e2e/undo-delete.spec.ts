import { expect, test } from "@playwright/test";
import {
  addTask,
  card,
  columnOrder,
  createProject,
  forAFinger,
  inDatabase,
  overflow,
  register,
  settles,
  unique,
} from "./helpers";

type Page = import("@playwright/test").Page;

/** Deletes the task whose panel is open, from the panel menu. */
async function deleteOpenTask(page: Page) {
  await page.getByRole("button", { name: "Task menu" }).click();
  await settles(page, /\/api\/tasks\/[0-9a-f-]+$/, () =>
    page.getByRole("button", { name: "Delete task" }).click(),
  );
}

/** Archives the task whose panel is open, from the panel menu. */
async function archiveOpenTask(page: Page) {
  await page.getByRole("button", { name: "Task menu" }).click();
  await page.getByTestId("archive-task").click();
  await expect(page.getByTestId("archived-row")).toBeVisible();
}

/**
 * Moves a deleted row back in time.
 *
 * The window is thirty days and a test cannot wait that long. It must not be
 * able to shorten the window either, because the window is the rule under
 * test, so it moves the moment the row carries instead — which is what an old
 * delete looks like from the outside.
 */
async function backdateDelete(projectId: string, key: string, days: number): Promise<void> {
  await inDatabase(async (client) => {
    await client.query(
      `update tasks set deleted_at = now() - ($1 || ' days')::interval
        where project_id = $2 and number = $3 and deleted_at is not null`,
      [String(days), projectId, Number(key.split("-")[1])],
    );
  });
}

test.describe("Undoing a delete", () => {
  /*
   * The whole way round: a delete takes the card off the board and the task
   * out of the search, the drawer holds it, and one press brings it back as
   * the task it was — with its key, its comment and its place.
   */
  test("a deleted task leaves the board and the search, and comes back whole", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Undo"));

    await addTask(page, "Todo", "Rotate the signing key");
    const key = await page.getByTestId("task-key").innerText();
    const comment = page.getByPlaceholder("Leave a note…");
    await comment.fill("The key is in the vault.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByRole("tab", { name: /^Comments 1/ })).toBeVisible();

    await addTask(page, "Todo", "Still on the board");
    await page.getByRole("button", { name: "Close task" }).click();

    await page.goto(`/p/${projectId}?task=${key}`);
    await deleteOpenTask(page);

    /* The way back is on another page, so the one line the board draws has to
       say so, and has to say how long there is. Without it the undo is
       invisible to anybody who never opens the Archive. */
    await expect(page.getByTestId("toast")).toContainText(
      `${key} deleted. Put it back from the Archive within 30 days.`,
    );

    // Off the board, and off it after a reload as well.
    await expect(card(page, "Rotate the signing key")).toHaveCount(0);
    await page.reload();
    await expect(card(page, "Rotate the signing key")).toHaveCount(0);
    await expect(card(page, "Still on the board").first()).toBeVisible();

    // A search hides it too. An archived task is still found; a deleted one
    // is not there at all.
    const box = page.getByTestId("search-box");
    await box.fill("signing key");
    await expect(page.getByTestId("search-hit")).toHaveCount(0);
    await box.fill("");

    // The drawer has it, with how long is left.
    await page.getByRole("link", { name: "Archive", exact: true }).click();
    await page.waitForURL(`**/p/${projectId}/archived`);
    const row = page.getByTestId("deleted-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(key);
    await expect(row).toContainText("Rotate the signing key");
    await expect(row).toContainText("Deleted just now");
    await expect(row).toContainText("30 days left");
    await expect(page.getByText("Deleted, gone in 30 days")).toBeVisible();
    /* Each list says its own count. One number over two lists would have to
       name which list it counted. */
    await expect(page.getByText("1 deleted task.")).toBeVisible();
    await expect(page.getByText("1 archived task.")).toHaveCount(0);

    // One press, no question asked: a put back takes nothing away.
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/restore$/, () =>
      row.getByTestId("deleted-put-back").click(),
    );
    await expect(page.getByTestId("deleted-row")).toHaveCount(0);
    await expect(page.getByTestId("deleted-section")).toHaveCount(0);
    await expect(page.getByTestId("toast")).toContainText("is back");

    // And it is the task it was: the same key, and everything on it.
    await page.goto(`/p/${projectId}?task=${key}`);
    await expect(page.getByTestId("task-key")).toHaveText(key);
    await expect(page.getByTestId("task-title")).toHaveValue("Rotate the signing key");
    await expect(page.getByRole("tab", { name: /^Comments 1/ })).toBeVisible();
    await expect(card(page, "Rotate the signing key").first()).toBeVisible();
  });

  /*
   * What delete means to whoever holds the id. Every route about the task
   * answers `404`, because the task is gone; put back is the one way out, and
   * it is the one route that may still see it.
   */
  test("every route about a deleted task answers 404, and restore answers 200", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Gone"));

    await addTask(page, "Todo", "Write the offline queue tests");
    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const taskId: string = board.tasks[0].id;
    const propertyId: string = board.properties[0].id;

    const deleted = await page.request.delete(`/api/tasks/${taskId}`);
    expect(deleted.status()).toBe(200);
    const said = await deleted.json();
    expect(said.ok).toBe(true);
    // The answer says how long there is, so a caller needs nothing else.
    expect(Date.parse(said.goesAt)).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

    const gone = [
      await page.request.get(`/api/tasks/${taskId}`),
      await page.request.patch(`/api/tasks/${taskId}`, { data: { title: "No" } }),
      await page.request.delete(`/api/tasks/${taskId}`),
      await page.request.put(`/api/tasks/${taskId}/values/${propertyId}`, {
        data: { value: null },
      }),
      await page.request.post(`/api/tasks/${taskId}/checklist`, { data: { text: "No" } }),
      await page.request.post(`/api/tasks/${taskId}/comments`, { data: { body: "No" } }),
      await page.request.post(`/api/tasks/${taskId}/run`, { data: { goal: "No" } }),
      await page.request.post(`/api/tasks/${taskId}/move`, { data: {} }),
      await page.request.post(`/api/tasks/${taskId}/archive`, { data: {} }),
    ];
    for (const answer of gone) {
      expect(answer.status(), `${answer.url()} should not answer for a deleted task`).toBe(404);
    }

    // It is not on the board answer either, live or archived.
    const after = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    expect(after.tasks).toHaveLength(0);
    expect(after.archived).toHaveLength(0);

    // The drawer has it, and the way out works twice.
    const drawer = await (await page.request.get(`/api/projects/${projectId}/deleted`)).json();
    expect(drawer.deleted.map((t: { id: string }) => t.id)).toEqual([taskId]);
    expect(drawer.windowDays).toBe(30);

    expect((await page.request.post(`/api/tasks/${taskId}/restore`)).status()).toBe(200);
    expect((await page.request.post(`/api/tasks/${taskId}/restore`)).status()).toBe(200);
    expect((await page.request.get(`/api/tasks/${taskId}`)).status()).toBe(200);
  });

  /*
   * The feed is the record, and a receiver watching `deleted` now hears a put
   * back too. It has to be able to tell them apart without reading the task,
   * which it cannot: the line carries no task id, because the activity row
   * would be swept away with the task it names.
   */
  test("the deleted feed line says which way round it went", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Feed"));

    await addTask(page, "Todo", "Ship the release image");
    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const taskId: string = board.tasks[0].id;
    const key: string = board.tasks[0].key;

    const from = new Date(Date.now() - 1000).toISOString();
    await page.request.delete(`/api/tasks/${taskId}`);
    await page.request.post(`/api/tasks/${taskId}/restore`);

    const feed = await (
      await page.request.get(`/api/projects/${projectId}/activity?after=${from}`)
    ).json();
    const lines = feed.entries.filter((e: { kind: string }) => e.kind === "deleted");

    expect(lines).toHaveLength(2);
    expect(lines[0].taskId).toBeNull();
    expect(lines[0].data.action).toBe("deleted");
    expect(lines[0].data.key).toBe(key);
    expect(typeof lines[0].data.goesAt).toBe("string");
    expect(lines[1].data.action).toBe("restored");
    expect(lines[1].data.key).toBe(key);
    expect(lines[1].data.goesAt).toBeNull();
  });

  /* The two marks are separate answers to separate questions. */
  test("a task deleted while it was archived comes back archived", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Both"));

    await addTask(page, "Todo", "Rate limit the sign-in route");
    const key = await page.getByTestId("task-key").innerText();
    await archiveOpenTask(page);
    await deleteOpenTask(page);

    await page.goto(`/p/${projectId}/archived`);
    await expect(page.getByTestId("archive-row")).toHaveCount(0);
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/restore$/, () =>
      page.getByTestId("deleted-put-back").click(),
    );

    // Back where it was, which was the archive and not the board.
    await expect(page.getByTestId("archive-row")).toHaveCount(1);
    await expect(page.getByTestId("archive-row")).toContainText(key);
    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Rate limit the sign-in route")).toHaveCount(0);
  });

  /*
   * The sweep runs on the write and on the read of the drawer, and there is no
   * timer. So a row past its window goes the next time somebody deletes
   * anything or opens this page — never a day later on a clock nobody runs.
   */
  test("a task past its thirty days is swept when the drawer is read", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Swept"));

    await addTask(page, "Todo", "Old enough to go");
    const old = await page.getByTestId("task-key").innerText();
    await deleteOpenTask(page);

    await addTask(page, "Todo", "Still inside the window");
    const young = await page.getByTestId("task-key").innerText();
    await deleteOpenTask(page);

    await backdateDelete(projectId, old, 31);

    const drawer = await (await page.request.get(`/api/projects/${projectId}/deleted`)).json();
    expect(drawer.deleted.map((t: { key: string }) => t.key)).toEqual([young]);

    // Swept means gone, not hidden: the row is not in the table any more.
    const left = await inDatabase(async (client) =>
      client.query(`select 1 from tasks where project_id = $1 and number = $2`, [
        projectId,
        Number(old.split("-")[1]),
      ]),
    );
    expect(left.rowCount).toBe(0);
  });

  /*
   * The quick way back. The toast that says where the task went carries the
   * button that brings it straight back, to the column and the place it left.
   */
  test("Undo in the toast puts the task back where it was", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Oops"));
    for (const title of ["First of three", "Second of three", "Third of three"]) {
      await addTask(page, "Todo", title);
      await page.getByRole("button", { name: "Close task" }).click();
    }
    const before = await columnOrder(page, "Todo");

    await card(page, "Second of three").first().click();
    const key = await page.getByTestId("task-key").innerText();
    await deleteOpenTask(page);

    const toast = page.getByTestId("toast");
    const undo = toast.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    // The Archive is still named, for the moment the toast has gone.
    await expect(toast).toContainText(
      `${key} deleted. Put it back from the Archive within 30 days.`,
    );
    // A toast that arrives never takes the focus from the board.
    await expect(undo).not.toBeFocused();
    await expect(card(page, "Second of three")).toHaveCount(0);

    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/restore$/, () => undo.click());
    await expect(toast).toHaveCount(0);
    await expect.poll(() => columnOrder(page, "Todo")).toEqual(before);

    await page.reload();
    await expect.poll(() => columnOrder(page, "Todo")).toEqual(before);
    await page.goto(`/p/${projectId}/archived`);
    await expect(page.getByTestId("deleted-row")).toHaveCount(0);
  });

  /* Tab reaches the button, and the toast waits while it holds the focus. */
  test("Undo is reached by the keyboard and waits while it has the focus", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Keys"));
    await addTask(page, "Todo", "Undone by a key");
    await deleteOpenTask(page);

    const undo = page.getByTestId("toast").getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    await expect(undo).not.toBeFocused();
    await page.keyboard.press("Tab");
    await expect(undo).toBeFocused();

    // Longer than any toast lives: a focused button must not vanish.
    await page.waitForTimeout(11_000);
    await expect(undo).toBeFocused();

    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/restore$/, () => page.keyboard.press("Enter"));
    await expect(page.getByTestId("toast")).toHaveCount(0);
    await expect(card(page, "Undone by a key").first()).toBeVisible();
  });
});

test.describe("The drawer on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("both lists fit the screen, and every way back is pressable", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Pocket"));

    await addTask(page, "Todo", "A short one");
    await archiveOpenTask(page);
    await page.getByRole("button", { name: "Close task" }).click();

    await addTask(page, "Todo", "A title long enough to need the whole of a small screen");
    await deleteOpenTask(page);
    await forAFinger(page.getByTestId("toast").getByRole("button", { name: "Undo" }), 1);

    await page.goto(`/p/${projectId}/archived`);
    await expect(page.getByTestId("archive-row")).toHaveCount(1);
    await expect(page.getByTestId("deleted-row")).toHaveCount(1);
    await expect(page.getByTestId("deleted-row")).toContainText("30 days left");

    expect(await overflow(page)).toBe(0);
    await forAFinger(page.getByRole("button", { name: /^Put .* back$/ }), 2);
  });
});
