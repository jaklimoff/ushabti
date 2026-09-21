import { expect, test } from "@playwright/test";
import {
  addFilter,
  addTask,
  card,
  column,
  columnOrder,
  createProject,
  overflow,
  register,
  settles,
  unique,
} from "./helpers";

type Page = import("@playwright/test").Page;

/** The one call a bulk set makes. Nothing else writes to it. */
const BULK = /\/api\/projects\/[0-9a-f-]+\/tasks\/values$/;

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
  await menu.getByRole("button", { name: /Empty/ }).first().click();
  await settles(page, BULK, () => menu.getByRole("button", { name: option }).first().click());
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

    /* Across columns there is no run: the cards between two columns on screen
       are not the cards between them in any order the board keeps. */
    await card(page, "Dingo").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pick-count")).toHaveText("4 selected");
    await expect(column(page, "Backlog").locator('[data-picked="true"]')).toHaveCount(1);
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
    const top = document.querySelector('[data-testid="board-mark"]')!.parentElement!;
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

    /* And it is a loan, not a taking. */
    await page.getByTestId("pick-clear").click();
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
    await expect(page.getByTestId("search-box")).toBeVisible();
    await expect(page.getByTitle("Project settings")).toBeVisible();
    expect(await topBarEnds(page)).toBeLessThanOrEqual(390);
  });
});
