import { expect, test } from "@playwright/test";
import {
  addFilter,
  addListView,
  addTask,
  card,
  column,
  columnOrder,
  createProject,
  forAFinger,
  gotoSettings,
  listOrder,
  listRow,
  overflow,
  register,
  settles,
  showColumn,
  unique,
} from "./helpers";

type Page = import("@playwright/test").Page;

/** The one call a bulk set makes. Nothing else writes to it. */
const BULK = /\/api\/projects\/[0-9a-f-]+\/tasks\/values$/;

/** The one call a bulk archive makes. The column sweep uses it too. */
const SWEEP = /\/api\/projects\/[0-9a-f-]+\/archive$/;

/** Three cards in Todo, and one in Backlog that is picked by nothing. */
async function fourCards(page: Page) {
  for (const title of ["Aardvark", "Beetle", "Cricket"]) {
    await addTask(page, "Todo", title);
    await page.getByRole("button", { name: "Close task" }).click();
  }
  await addTask(page, "Backlog", "Dingo");
  await page.getByRole("button", { name: "Close task" }).click();
}

/** The check in the corner of one card. A press picks it, or puts it back. */
function check(page: Page, title: string) {
  return card(page, title).getByTestId("card-pick");
}

/** What the browser thinks is selected, which after a Shift-click is nothing. */
function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

async function pick(page: Page, ...titles: string[]) {
  for (const title of titles) await check(page, title).click();
}

/** Says which property to set, and waits for the board to move. */
async function setOnPicked(page: Page, property: string, option: string) {
  await page.getByTestId("pick-set").click();
  const search = page.getByTestId("pick-search");
  await search.fill(property);
  await search.press("Enter");

  const menu = page.getByTestId("pick-menu");
  await menu
    .getByRole("button", { name: `No ${property.toLowerCase()}` })
    .first()
    .click();
  await settles(page, BULK, () => menu.getByRole("option", { name: option }).first().click());
  await page.keyboard.press("Escape");
}

test.describe("Picking several cards", () => {
  test("sets one property on all of them, in one call", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Picked"));
    await fourCards(page);

    /* The bar is not there at rest: nothing is picked when a board opens. */
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);

    await pick(page, "Aardvark", "Beetle", "Cricket");
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    /* The card wears a border and nothing more. */
    await expect(page.locator('[data-testid="card"][data-picked="true"]')).toHaveCount(3);

    /* One call for three cards, not three. A second call would say the board
       was set one card at a time, which is the thing the route exists to
       stop. */
    const calls: string[] = [];
    await page.route("**/api/projects/**", (route) => {
      const asked = route.request();
      if (asked.method() !== "GET") calls.push(new URL(asked.url()).pathname);
      return route.fallback();
    });

    await setOnPicked(page, "Status", "In Progress");

    expect(await columnOrder(page, "In Progress")).toEqual(["Aardvark", "Beetle", "Cricket"]);
    expect(await columnOrder(page, "Todo")).toEqual([]);
    expect(calls.filter((path) => path.endsWith("/tasks/values"))).toHaveLength(1);

    /* The picks stand after a set: setting a second property on the same
       cards is the next thing anybody does. */
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");

    /* And it is really written, not only drawn. */
    await page.reload();
    expect(await columnOrder(page, "In Progress")).toEqual(["Aardvark", "Beetle", "Cricket"]);
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
  });

  test("Escape ends it, and so does the ✕", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Escaped"));
    await fourCards(page);

    await pick(page, "Aardvark", "Beetle");
    await expect(page.getByTestId("pick-count")).toHaveText("2 selected");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
    await expect(page.locator('[data-testid="card"][data-picked="true"]')).toHaveCount(0);

    await pick(page, "Aardvark");
    await page.getByTestId("pick-clear").click();
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);

    /* Escape puts away one thing. With a task open it is the task, and the
       picks are still there for the next press. */
    await pick(page, "Aardvark", "Beetle", "Cricket");
    await card(page, "Dingo").click();
    await expect(page.getByTestId("task-panel")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-panel")).toHaveCount(0);
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);

    /* What is picked belongs to the board on screen, so another view ends it
       rather than carrying a handful of cards across. */
    await pick(page, "Aardvark", "Beetle");
    await page.getByRole("button", { name: /^Phases/ }).click();
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
    await page.getByRole("button", { name: /^Board/ }).click();
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
  });

  /* `x` is the whole keyboard route in. The checks are not tab stops, because
     the board has one, and that one is the card the cursor is on. */
  test("x picks the card the cursor is on", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Keys"));
    await fourCards(page);

    /* The board's one tab stop is the card the cursor is on, which starts at
       the first card of the first column. */
    const cursor = page.locator('[data-testid="card"][tabindex="0"]');
    await cursor.focus();
    await expect(cursor).toContainText("Dingo");

    await page.keyboard.press("x");
    await expect(page.getByTestId("pick-count")).toHaveText("1 selected");
    await expect(card(page, "Dingo")).toHaveAttribute("data-picked", "true");

    /* The arrows move the cursor, so the next `x` picks another card. */
    await page.keyboard.press("ArrowRight");
    await expect(cursor).toContainText("Aardvark");
    await page.keyboard.press("x");
    await expect(page.getByTestId("pick-count")).toHaveText("2 selected");

    /* The same key takes one back, so nothing is a one-way press. */
    await page.keyboard.press("x");
    await expect(page.getByTestId("pick-count")).toHaveText("1 selected");
  });

  /* A filter decides what the view draws, so it decides what the bar counts
     and what a set writes. The card is not unpicked: a filter hides. */
  test("a card a filter hides leaves the picks", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Filtered"));
    await fourCards(page);

    await card(page, "Aardvark").click();
    await page.getByRole("button", { name: "High", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await pick(page, "Aardvark", "Beetle", "Cricket");
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");

    await addFilter(page, "Priority", "High");
    await expect(card(page, "Beetle")).toHaveCount(0);
    await expect(page.getByTestId("pick-count")).toHaveText("1 selected");
  });

  /* Shift says "and the ones in between". A plain click still opens the task,
     which is what makes picking a thing you can do without a mode. */
  test("Shift-click picks a run inside one column", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Run"));
    await fourCards(page);

    await check(page, "Aardvark").click();
    await card(page, "Cricket").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    /* Shift opens nothing. */
    await expect(page.getByTestId("task-panel")).toHaveCount(0);
    /* And it selects no words: a Shift-press on a card means "and the ones in
       between", so the browser's own selection never starts. */
    expect(await selectedText(page)).toBe("");

    /* Across columns there is no run: the cards between two columns on screen
       are not the cards between them in any order the board keeps. */
    await card(page, "Dingo").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pick-count")).toHaveText("4 selected");
    await expect(column(page, "Backlog").locator('[data-picked="true"]')).toHaveCount(1);
  });

  /* A plain click opens a task and picks nothing, so the run is measured from
     the open task, as a click and a Shift-click are in every file list. */
  test("Shift-click after a plain click picks the open card and all between", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Opened"));
    await fourCards(page);
    const picked = page.locator('[data-testid="card"][data-picked="true"]');

    /* Downward. */
    await card(page, "Aardvark").click();
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
    await card(page, "Cricket").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    await page.getByRole("button", { name: "Close task" }).click();
    await page.getByTestId("pick-clear").click();

    /* Upward. */
    await card(page, "Cricket").click();
    await card(page, "Aardvark").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    await page.getByRole("button", { name: "Close task" }).click();
    await page.getByTestId("pick-clear").click();

    /* With nothing open and nothing picked, there is no run: not even from
       the board cursor, which sits on the first card. */
    await card(page, "Beetle").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pick-count")).toHaveText("1 selected");
    await expect(card(page, "Beetle")).toHaveAttribute("data-picked", "true");
    await page.getByTestId("pick-clear").click();

    /* The open task is in another column: a run across two columns is two
       runs, so only the clicked card is picked. */
    await card(page, "Dingo").click();
    await card(page, "Cricket").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pick-count")).toHaveText("1 selected");
    await expect(picked).toHaveCount(1);
    await expect(card(page, "Cricket")).toHaveAttribute("data-picked", "true");
  });
});

/*
 * Archive takes the cards off the board, so the bar itself becomes the
 * question. No dialog, one call, and the picks end with it: a bar still
 * counting cards nobody can see would be counting nothing.
 */
test.describe("Archiving what is picked", () => {
  test("asks in the bar, then takes all three off the board", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Swept"));
    await fourCards(page);

    await pick(page, "Aardvark", "Beetle", "Cricket");
    await page.getByTestId("pick-archive").click();

    /* The bar is the question, and it names the real number. */
    await expect(page.getByTestId("pick-confirm")).toHaveText("Archive 3 tasks?");
    await expect(page.getByTestId("pick-set")).toHaveCount(0);

    /* Cancel puts the bar back and the cards stay where they are. */
    await page.getByTestId("pick-archive-no").click();
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    await expect(card(page, "Aardvark")).toBeVisible();

    /* And so does Escape, before it reaches the picks. */
    await page.getByTestId("pick-archive").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");

    /* One call for three cards, not three. */
    const calls: string[] = [];
    await page.route("**/api/**", (route) => {
      const asked = route.request();
      if (asked.method() !== "GET") calls.push(new URL(asked.url()).pathname);
      return route.fallback();
    });

    await page.getByTestId("pick-archive").click();
    await settles(page, SWEEP, () => page.getByTestId("pick-archive-yes").click());

    expect(calls.filter((path) => path.endsWith("/archive"))).toHaveLength(1);
    await expect(page.getByTestId("toast")).toContainText("Archived 3 tasks.");

    /* Gone from the board, and the pick went with them. */
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
    expect(await columnOrder(page, "Todo")).toEqual([]);
    await expect(card(page, "Dingo")).toBeVisible();

    /* Really archived, not only drawn: all three are on the archive page. */
    await page.goto(`/p/${projectId}/archived`);
    const rows = page.getByTestId("archive-row");
    await expect(rows).toHaveCount(3);
    for (const title of ["Aardvark", "Beetle", "Cricket"]) {
      await expect(rows.filter({ hasText: title })).toHaveCount(1);
    }
  });

  /*
   * A refusal leaves the picks where they were. The call can be refused for a
   * reason nobody could see coming — a task somebody else deleted a moment
   * ago, a socket that dropped — and having to pick twenty cards again is a
   * worse answer than the toast.
   */
  test("a refused archive keeps the picks", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Refused"));
    await fourCards(page);

    await pick(page, "Aardvark", "Beetle", "Cricket");

    await page.route("**/api/projects/*/archive", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "One of those tasks is not on this board." }),
          })
        : route.fallback(),
    );

    await page.getByTestId("pick-archive").click();
    await page.getByTestId("pick-archive-yes").click();

    await expect(page.getByTestId("toast")).toContainText("not on this board");
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    await expect(card(page, "Aardvark")).toBeVisible();
    expect(await columnOrder(page, "Todo")).toEqual(["Aardvark", "Beetle", "Cricket"]);
  });

  /*
   * Taking a handful of cards off the board is a decision about the board, so
   * the widened route is a person's exactly as the column sweep was.
   */
  test("an agent may not archive the tasks a person picked", async ({ page, request }) => {
    await register(page, "Token Owner");
    const projectId = await createProject(page, unique("Guarded"));
    await addTask(page, "Todo", "Not for a machine");
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Sweeper");
    await page.getByRole("button", { name: "Add agent" }).click();
    const box = page.getByTestId("agent-box").filter({ hasText: "Sweeper" });
    await box.getByRole("button", { name: "Connect" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
    ).trim();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const board = await (await request.get(`/api/projects/${projectId}/board`, { headers })).json();
    const taskId = board.tasks.find((t: { title: string }) => t.title === "Not for a machine").id;

    /* Both bodies, one guard. */
    const named = await request.post(`/api/projects/${projectId}/archive`, {
      headers,
      data: { taskIds: [taskId] },
    });
    expect(named.status()).toBe(403);

    /* And it archived nothing: the one task is still live. */
    const after = await (await request.get(`/api/projects/${projectId}/board`, { headers })).json();
    expect(after.tasks.map((t: { id: string }) => t.id)).toContain(taskId);

    /* The task route is the agent's own way, and it still works. */
    const one = await request.post(`/api/tasks/${taskId}/archive`, { headers, data: {} });
    expect(one.status()).toBe(200);
  });
});

/** Five hundred tasks, made through the route, so the board opens on them. */
async function fiveHundred(page: Page, projectId: string) {
  const titles = Array.from({ length: 500 }, (_, i) => `Row ${String(i + 1).padStart(3, "0")}`);
  for (let at = 0; at < titles.length; at += 25) {
    await Promise.all(
      titles.slice(at, at + 25).map(async (title) => {
        const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
          data: { title },
        });
        expect(made.status()).toBe(201);
      }),
    );
  }
  await page.reload();
}

/** Picks every row of the list: the first by its check, the rest by Shift. */
async function pickAllRows(page: Page) {
  const rows = page.getByTestId("list-row");
  await expect(rows).toHaveCount(500);
  await rows.first().getByTestId("list-pick").click();
  await rows.last().click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("pick-count")).toHaveText("500 selected");
}

/** Every write the page sends to one path, counted as it goes out. */
function writesTo(page: Page, ending: string): string[] {
  const calls: string[] = [];
  page.on("request", (asked) => {
    if (asked.method() !== "GET" && new URL(asked.url()).pathname.endsWith(ending)) {
      calls.push(asked.url());
    }
  });
  return calls;
}

/*
 * The route takes two hundred ids at most, and a Shift-click in a long list
 * picks more than that without a word. So the browser sends the picks in a
 * few calls one after another, and if one is refused it says how far it got.
 */
test.describe("Picking more than one call holds", () => {
  test.setTimeout(120_000);

  test("500 picked tasks archive in one press", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Many"));
    await fiveHundred(page, projectId);
    await addListView(page, "Everything");
    await pickAllRows(page);

    const calls = writesTo(page, "/archive");
    await page.getByTestId("pick-archive").click();
    await page.getByTestId("pick-archive-yes").click();

    await expect(page.getByTestId("toast")).toContainText("Archived 500 tasks.");
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
    await expect(page.getByTestId("list-row")).toHaveCount(0);
    expect(calls).toHaveLength(3);

    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    expect(board.tasks).toHaveLength(0);
    expect(board.archived).toHaveLength(500);
  });

  test("a refused batch gives both counts and keeps only what did not go", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Half"));
    await fiveHundred(page, projectId);
    await addListView(page, "Everything");
    await pickAllRows(page);

    /* The first call goes through; the second is refused, and the third is
       never sent. */
    let seen = 0;
    await page.route("**/api/projects/*/archive", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      seen += 1;
      if (seen === 1) return route.fallback();
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "One of those tasks is not on this board." }),
      });
    });

    await page.getByTestId("pick-archive").click();
    await page.getByTestId("pick-archive-yes").click();

    await expect(page.getByTestId("toast")).toContainText(
      "Archived 200 of 500. The rest did not: One of those tasks is not on this board.",
    );
    expect(seen).toBe(2);
    /* The refresh puts the cards of the refused batch back, and they are the
       only ones still picked. */
    await expect(page.getByTestId("list-row")).toHaveCount(300);
    await expect(page.getByTestId("pick-count")).toHaveText("300 selected");
    await expect(page.locator('[data-testid="list-row"][data-picked="true"]')).toHaveCount(300);
  });

  test("setting a value on 500 picked tasks writes all 500", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Set many"));
    await fiveHundred(page, projectId);
    await addListView(page, "Everything");
    await pickAllRows(page);

    const calls = writesTo(page, "/tasks/values");
    await page.getByTestId("pick-set").click();
    const search = page.getByTestId("pick-search");
    await search.fill("Priority");
    await search.press("Enter");
    await page.getByTestId("pick-menu").getByRole("button", { name: "Urgent" }).click();
    await expect.poll(() => calls.length).toBe(3);
    await page.keyboard.press("Escape");

    /* A set keeps its picks, whatever the number. */
    await expect(page.getByTestId("pick-count")).toHaveText("500 selected");

    /* Really written: every task on the server carries the one option. */
    await expect
      .poll(async () => {
        const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
        const priority = board.properties.find((p: { name: string }) => p.name === "Priority");
        const urgent = priority.options.find((o: { name: string }) => o.name === "Urgent").id;
        return board.tasks.filter(
          (t: { values: Record<string, unknown> }) => t.values[priority.id] === urgent,
        ).length;
      })
      .toBe(500);
  });
});

/*
 * A list is the same tasks lying down, so it picks the same way. The check is
 * in the gutter before the key rather than a column of its own: the columns of
 * a list are the rows of the card view and nothing else.
 */
test.describe("Picking on a list", () => {
  test("Shift-click after a plain click picks the open row and all between", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Opened list"));
    await fourCards(page);
    await addListView(page, "Everything");

    await listRow(page, "Aardvark").click();
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
    await listRow(page, "Cricket").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    await page.getByRole("button", { name: "Close task" }).click();
    await page.getByTestId("pick-clear").click();

    await listRow(page, "Dingo").click();
    await listRow(page, "Beetle").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    await expect(listRow(page, "Aardvark")).not.toHaveAttribute("data-picked", "true");
  });

  test("x and Shift-click pick, and Set writes all of them", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Lying down"));
    await fourCards(page);
    await addListView(page, "Everything");
    expect(await listOrder(page)).toEqual(["Aardvark", "Beetle", "Cricket", "Dingo"]);

    /* The list's one tab stop is the row the cursor is on, and `x` picks it. */
    const cursor = page.locator('[data-testid="list-row"][tabindex="0"]');
    await cursor.focus();
    await expect(cursor).toContainText("Aardvark");
    await page.keyboard.press("x");
    await expect(page.getByTestId("pick-count")).toHaveText("1 selected");
    await expect(listRow(page, "Aardvark")).toHaveAttribute("data-picked", "true");

    /* The same key takes it back. */
    await page.keyboard.press("x");
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);

    /* The check is in the gutter, not a column: the headings are the same
       whether anything is picked or not. */
    const headings = await page.getByTestId("list-head").locator("> *").count();
    await listRow(page, "Aardvark").getByTestId("list-pick").click();
    await expect(page.getByTestId("pick-count")).toHaveText("1 selected");
    await expect(page.getByTestId("list-head").locator("> *")).toHaveCount(headings);

    /* A real range, down the whole list: a list is one column of rows, so the
       rows between two of them on screen are the rows between them. */
    await listRow(page, "Dingo").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pick-count")).toHaveText("4 selected");
    /* Shift opens nothing. */
    await expect(page.getByTestId("task-panel")).toHaveCount(0);
    /* And it selects no words. A table is the place this shows worst: without
       it the rows go blue from the heading down. */
    expect(await selectedText(page)).toBe("");

    /* And the same bar writes the same one call. Priority is on the card, so
       a row wears it too: one card view, two drawings. A property of four
       options is a row of buttons rather than a menu, so it is pressed here
       and not through `setOnPicked`. */
    await page.getByTestId("pick-set").click();
    const search = page.getByTestId("pick-search");
    await search.fill("Priority");
    await search.press("Enter");
    const menu = page.getByTestId("pick-menu");
    await settles(page, BULK, () => menu.getByRole("button", { name: "Urgent" }).click());
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(page.getByTestId("list-view")).toBeVisible();
    for (const title of ["Aardvark", "Beetle", "Cricket", "Dingo"]) {
      await expect(listRow(page, title).getByText("Urgent")).toBeVisible();
    }
  });
});

/**
 * The right edge of the last thing on the top bar that takes any room.
 *
 * The shell hides its own overflow, so a bar that is too long is clipped in
 * silence rather than scrolled. Measuring the end is the only way to see it.
 */
async function topBarEnds(page: Page): Promise<number> {
  return page.evaluate(() => {
    const top = document.querySelector('[data-testid="top-bar"]')!;
    const drawn = [...top.children].filter((el) => el.getBoundingClientRect().width > 0);
    return Math.round(drawn[drawn.length - 1].getBoundingClientRect().right);
  });
}

/*
 * The bar reaches a phone, and the top bar there was already exactly full. So
 * this measures it rather than trusting a look: while something is picked the
 * search box and the two links off the board give it their room, and take it
 * back the moment nothing is.
 */
test.describe("Picking on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("the bar fits the top bar, and nothing is pushed off it", async ({ page }) => {
    await register(page, "Wilhelmina Featherstonehaugh");
    await createProject(page, unique("Pocket"));
    await fourCards(page);

    expect(await topBarEnds(page)).toBeLessThanOrEqual(390);

    /* A phone draws one column, so the cards to pick have to be the ones on
       screen. The bar itself is the same bar at any width. */
    await showColumn(page, "Todo");
    await pick(page, "Aardvark", "Beetle");
    await expect(page.getByTestId("pick-bar")).toBeVisible();
    expect(await overflow(page)).toBe(0);
    expect(await topBarEnds(page)).toBeLessThanOrEqual(390);

    /* What gave the room, and what kept its place. */
    await expect(page.getByTestId("search-box")).toBeHidden();
    await expect(page.getByTitle("Project settings")).toBeHidden();
    await expect(page.getByTestId("board-mark")).toBeVisible();
    await expect(page.getByTestId("pick-set")).toBeVisible();

    /* A finger has something to press. */
    for (const target of [page.getByTestId("pick-set"), page.getByTestId("pick-clear")]) {
      const box = await target.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(20);
      expect(box!.height).toBeGreaterThanOrEqual(20);
    }

    /* The question is longer than the count, so it is measured too: the mark
       lends it the last of the room while it stands. */
    await page.getByTestId("pick-archive").click();
    await expect(page.getByTestId("pick-confirm")).toHaveText("Archive 2 tasks?");
    expect(await overflow(page)).toBe(0);
    expect(await topBarEnds(page)).toBeLessThanOrEqual(390);
    await page.getByTestId("pick-archive-no").click();

    /* And it is a loan, not a taking. */
    await page.getByTestId("pick-clear").click();
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
    await expect(page.getByTestId("search-box")).toBeVisible();
    await expect(page.getByTitle("Project settings")).toBeVisible();
    expect(await topBarEnds(page)).toBeLessThanOrEqual(390);
  });
});

/*
 * The box that finds a task is off the top bar below 900 px while something is
 * picked, and `/` went on asking for it. So the key did nothing, in silence,
 * and Escape then `/` was the only way in.
 */
test.describe("/ while cards are picked", () => {
  test.use({ viewport: { width: 600, height: 820 } });

  test("leaves the picks out and puts the cursor in the box", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Slashed"));
    await fourCards(page);

    await pick(page, "Aardvark", "Beetle", "Cricket");
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    /* The box is not on the bar. This is the press that used to do nothing. */
    await expect(page.getByTestId("search-box")).toBeHidden();

    await page.keyboard.press("/");

    /* A search hides nothing and ends by opening one task, so it wins. */
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
    await expect(page.locator('[data-testid="card"][data-picked="true"]')).toHaveCount(0);
    await expect(page.getByTestId("search-box")).toBeFocused();
    /* The key opened the box; it did not land in it. */
    await expect(page.getByTestId("search-box")).toHaveValue("");
  });
});

/*
 * The check in a list gutter under a finger. It was a 14 px square in a 28 px
 * gutter on a 32 px row, and a miss opened the task.
 */
test.describe("Picking on a list under a finger", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });

  test("gives the check a finger's room, and draws the same check", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Pocket list"));
    await addTask(page, "Todo", "Aardvark");
    await page.getByRole("button", { name: "Close task" }).click();
    await addListView(page, "Everything");

    const check = listRow(page, "Aardvark").getByTestId("list-pick");
    /* It stands there without a hover, because a finger has none. */
    expect(await check.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await forAFinger(check, 1);

    /* The button grew around the box, so the check reads as it always did. */
    const box = await check.getByTestId("list-pick-box").boundingBox();
    expect(Math.round(box!.width)).toBe(14);
    expect(Math.round(box!.height)).toBe(14);
  });
});
