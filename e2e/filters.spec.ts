import { expect, test } from "@playwright/test";
import {
  addFilter,
  addTask,
  card,
  column,
  createProject,
  gotoSettings,
  putFilterOnView,
  register,
  saved,
  settles,
  unique,
} from "./helpers";

type Page = import("@playwright/test").Page;

function chip(page: Page, text: string) {
  return page.getByTestId("filter-chip").filter({ hasText: text });
}

/**
 * A day counted from another day, as YYYY-MM-DD.
 *
 * Plain arithmetic on the string the board says today is. Nothing here reads
 * a clock or a zone: the test machine is in some zone of its own, and the
 * whole point of the test below is that only one day matters.
 */
function dayFrom(today: string, offset: number): string {
  const at = new Date(
    Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10))) +
      offset * 86_400_000,
  );
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return `${at.getUTCFullYear()}-${month}-${day}`;
}

/** How many days back the Monday of that day's week is. The week starts Monday. */
function toMonday(today: string): number {
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  return -((weekday + 6) % 7);
}

/** Sets the date of the Due property on the task whose panel is open. */
async function setDue(page: Page, when: string) {
  const due = page.locator('[data-property="Due"]');
  await due.getByRole("button").click();
  await saved(page, async () => {
    await due.locator("input").fill(when);
    await due.locator("input").blur();
  });
}

/*
 * What the strip and the panel draw for a set of rules, and what a press
 * sends, are component tests now: `src/components/board/Filters.test.tsx`.
 * What is left here needs a server, a reload or a second tab, and each test
 * says which. See docs/testing.md. The four that only called the routes are
 * `lens-route.test.ts`.
 */

test.describe("Filters inside a view", () => {
  // Stays: a reload has to find the rule, saved against this person and view.
  test("a filter belongs to its view, and stays there", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Belonging"));

    await addTask(page, "Todo", "Only task");
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    // The other view was never filtered and must not be.
    await page.getByRole("button", { name: /^Phases/ }).click();
    await expect(page.getByTestId("filter-row")).toHaveCount(0);
    await expect(card(page, "Only task")).toBeVisible();

    await page.getByRole("button", { name: /^Board/ }).click();
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    // It is saved against this person and this view, not held in this tab, so
    // a reload finds it again.
    await page.goto(`/p/${projectId}`);
    await expect(chip(page, "Priority is Urgent")).toBeVisible();
    await expect(card(page, "Only task")).toHaveCount(0);
  });

  /* The same again where the rule is the team's. The column joins the view's
     set, for everybody, and nothing of mine is written. */
  // Stays: a reload has to find the column and the rule on the view.
  test("a new column joins the view's own rule, for everybody", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("NewColumnOnView"));

    await addFilter(page, "Status", "Backlog");
    await putFilterOnView(page);
    await expect(chip(page, "Status is Backlog")).toBeVisible();
    await expect(page.getByTestId("filter-mine")).toHaveCount(0);
    await expect(column(page, "Todo")).toHaveCount(0);

    let mine = 0;
    page.on("request", (req) => {
      if (/\/lens$/.test(new URL(req.url()).pathname)) mine += 1;
    });

    await page.getByRole("button", { name: "New column" }).click();
    const box = page.getByPlaceholder("Column name");
    await box.fill("Blocked");
    await settles(page, /\/api\/views\/[0-9a-f-]+$/, () => box.press("Enter"));

    await expect(column(page, "Blocked")).toBeVisible();
    await expect(chip(page, "Status is Backlog, Blocked")).toBeVisible();
    // The rule is still the team's, and nothing of mine was written.
    await expect(page.getByTestId("filter-mine")).toHaveCount(0);
    expect(mine).toBe(0);

    // It is the view that carries it, so a reload finds the column and the
    // rule where the whole team keeps them.
    await page.goto(`/p/${projectId}`);
    await expect(column(page, "Blocked")).toBeVisible();
    await expect(chip(page, "Status is Backlog, Blocked")).toBeVisible();
    await expect(page.getByTestId("filter-chip").first()).toHaveAttribute("data-shared", "true");
  });

  // Stays: the rule has to survive the round trip through the server.
  test("a date rule is made empty and filled in afterwards", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Dates"));

    for (const [title, when] of [
      ["Due soon", "2026-09-01"],
      ["Due later", "2026-12-01"],
    ]) {
      await addTask(page, "Todo", title);
      const due = page.locator('[data-property="Due"]');
      await due.getByRole("button").click();
      await saved(page, async () => {
        await due.locator("input").fill(when);
        await due.locator("input").blur();
      });
      await page.getByRole("button", { name: "Close task" }).click();
    }

    // For a date the box is the answer, so there is no list to pick from.
    await page.getByTestId("filter-button").click();
    const search = page.getByTestId("filter-search");
    await search.fill("Due");
    await search.press("Enter");

    // The operator is the shape of the question, so it may have a default.
    // The answer may not, so no rule exists yet.
    await expect(page.getByTestId("filter-row")).toHaveCount(1);
    await expect(page.getByTestId("filter-chip")).toHaveCount(0);
    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");

    await page.getByRole("button", { name: "is before" }).click();
    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, async () => {
      await page.getByTestId("filter-box").fill("2026-10-01");
      await page.getByTestId("filter-box").press("Enter");
    });

    await expect(chip(page, "Due is before 2026-10-01")).toBeVisible();
    await expect(card(page, "Due soon")).toBeVisible();
    await expect(card(page, "Due later")).toHaveCount(0);

    // It survives the round trip, empty start and all.
    await page.goto(`/p/${projectId}`);
    await expect(chip(page, "Due is before 2026-10-01")).toBeVisible();
  });

  /*
   * The box saves on blur like every field on this board, and a tab closed on
   * it sends no blur. The answer goes out on the way off the page instead.
   */
  // Stays: a closed tab and a fresh one.
  test("a rule answered in a closed tab is there when the board comes back", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("LeavingFilter"));

    await page.getByTestId("filter-button").click();
    const search = page.getByTestId("filter-search");
    await search.fill("Due");
    await search.press("Enter");

    // Typed and left there: no Enter, no click elsewhere, no blur.
    await page.getByTestId("filter-box").fill("2026-10-01");

    const context = page.context();
    await page.close();

    const next = await context.newPage();
    await expect
      .poll(
        async () => {
          await next.goto(`/p/${projectId}`);
          return next.getByTestId("filter-chip").allInnerTexts();
        },
        { timeout: 20_000 },
      )
      .toContain("Due is on 2026-10-01");
  });

  /*
   * The other half of that rule. The box is filled in when it opens and goes
   * stale the moment another tab answers the same question, so a box nobody
   * typed in owes nothing: it must put no words back on the way out.
   */
  // Stays: two tabs and the stream between them.
  test("a box nobody typed in puts nothing back over another tab's answer", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("StaleBox"));

    /* The rule is the view's and not mine, because a lens moves one screen
       and rings nobody: the other tab has to hear this one. */
    await addFilter(page, "Due", "2026-10-01");
    await putFilterOnView(page);
    await expect(chip(page, "Due is on 2026-10-01")).toBeVisible();

    // This tab opens the question on that rule and types nothing.
    await chip(page, "Due is on 2026-10-01").click();
    await expect(page.getByTestId("filter-box")).toHaveValue("2026-10-01");

    // The other tab answers it differently.
    const other = await page.context().newPage();
    await other.goto(`/p/${projectId}`);
    await other.getByTestId("filter-chip").click();
    const box = other.getByTestId("filter-box");
    await settles(other, /\/api\/views\/[0-9a-f-]+$/, async () => {
      await box.fill("2026-11-01");
      await box.press("Enter");
    });
    await other.keyboard.press("Escape");

    // This tab hears it, with the old day still in the open box.
    await expect(chip(page, "Due is on 2026-11-01")).toBeVisible({ timeout: 20_000 });

    /* Escape puts the question away, which unmounts the box. It owes nothing,
       so the day it was born with goes nowhere. */
    await page.getByTestId("filter-box").press("Escape");
    await expect(page.getByTestId("filter-editor")).toHaveCount(0);

    // The other tab's answer stands, in this tab and on the board.
    await expect(chip(page, "Due is on 2026-11-01")).toBeVisible();
    await other.waitForTimeout(2_000);
    await other.reload();
    await expect(other.getByTestId("filter-chip")).toHaveText("Due is on 2026-11-01");
  });

  // Stays: Settings deletes the option and the server reads the rule afresh.
  test("a rule whose option is deleted goes with it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Deleting"));

    await addTask(page, "Todo", "Only task");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    await page.goto(`/p/${projectId}/settings/properties`);
    await page.getByRole("button", { name: "Delete the option Urgent" }).click();
    await settles(page, /\/api\/options\//, () =>
      page.getByRole("button", { name: "Yes, delete" }).click(),
    );

    // The rule named one option and that option has gone, so the rule has
    // nothing left to ask. A filter nobody can see must not keep hiding cards.
    await page.goto(`/p/${projectId}`);
    await expect(page.getByTestId("filter-row")).toHaveCount(0);
    await expect(card(page, "Only task")).toBeVisible();
  });

  /* ---------------------------------------------------------------- */
  /* Yours, and the view's                                             */
  /* ---------------------------------------------------------------- */

  // Stays: the promote is a real write, and a reload has to find it on the view.
  test(
    "a rule I add says it is mine, and one press makes it the view's",
    { tag: "@smoke" },
    async ({ page }) => {
      await register(page);
      const projectId = await createProject(page, unique("Mine"));

      await addTask(page, "Todo", "Urgent thing");
      await page.getByRole("button", { name: "Urgent", exact: true }).click();
      await page.getByRole("button", { name: "Close task" }).click();

      await addFilter(page, "Priority", "Urgent");

      // The row says who can see it, and offers the one way to change that.
      await expect(page.getByTestId("filter-mine")).toBeVisible();
      await expect(page.getByText("Only you see this")).toBeVisible();
      // Nothing is on the view yet, so there is no divider to draw.
      await expect(page.getByTestId("filter-divider")).toHaveCount(0);

      await putFilterOnView(page);

      // The rule is the view's now: the same chip, and nothing left that is mine.
      await expect(chip(page, "Priority is Urgent")).toBeVisible();
      await expect(page.getByTestId("filter-mine")).toHaveCount(0);
      await expect(page.getByTestId("filter-clear")).toHaveCount(0);
      await expect(page.getByTestId("filter-button")).toContainText("Filter 1");

      // And it stays the view's over a reload.
      await page.goto(`/p/${projectId}`);
      await expect(chip(page, "Priority is Urgent")).toBeVisible();
      await expect(page.getByTestId("filter-mine")).toHaveCount(0);
    },
  );
});

/*
 * The browser is never on the project's day, at any hour.
 *
 * Kiritimati is UTC+14 and the project below sits on UTC−12: twenty-six hours
 * apart, so the two are never on the same date — not for part of the day, as
 * a nearer pair would be, but at every instant of every day. Neither zone has
 * summer time, so that holds next March as well.
 *
 * A board that worked a window out from this browser's clock would therefore
 * draw one set of cards on the server and another the moment it hydrated.
 * Everything below has to hold anyway, and the console has to stay quiet.
 */
const PROJECT_ZONE = "Etc/GMT+12";

test.describe("A date rule that names a window of days", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  // Stays: the server draws the board in one zone and the browser hydrates it in another.
  test("holds a week still, and reads the same after a reload", async ({ page }) => {
    const noise: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") noise.push(message.text());
    });
    page.on("pageerror", (error) => noise.push(error.message));

    await register(page);
    const projectId = await createProject(page, unique("Windows"));

    /* The zone is the project's, and the owner says which. */
    await gotoSettings(page, projectId, "project");
    const zone = page.getByLabel("The time zone this project's day is worked out in");
    await expect(zone).toHaveValue("UTC");

    /* The row saves on blur, and the save is a request. A reload started
       before it comes back reads the zone the server still has, which is the
       old one, so every step below waits for the answer first. */
    const zoneSaved = /\/api\/projects\/[0-9a-f-]+$/;

    // A name this server does not know is refused in one line, and nothing
    // is saved: a zone that quietly became UTC would move every card.
    await zone.fill("Europe/Atlantis");
    await settles(page, zoneSaved, () => zone.blur());
    await expect(page.getByTestId("toast")).toContainText("No time zone is called Europe/Atlantis");
    await page.reload();
    await expect(zone).toHaveValue("UTC");

    /* And a name that is not a place is still a zone. `Etc/GMT+12` is UTC−12,
       and it is one of the names the CLDR list leaves out — so this row also
       says that the board asks the formatter and not a list. */
    await zone.fill(PROJECT_ZONE);
    await settles(page, zoneSaved, () => zone.blur());
    await expect(page.getByTestId("toast")).toHaveCount(0);
    await page.reload();
    await expect(zone).toHaveValue(PROJECT_ZONE);

    /* That 400 is the refusal we asked for. Everything the board says from
       here on has to be quiet. */
    noise.length = 0;

    /*
     * The day the server says it is, which is the only day on this screen.
     * The test does its own Monday arithmetic from there, so it never has to
     * know what zone the machine running it is in.
     */
    const board = await page.request.get(`/api/projects/${projectId}/board`);
    const { today } = (await board.json()) as { today: string };
    const sunday = dayFrom(today, toMonday(today) + 6);
    const nextTuesday = dayFrom(today, toMonday(today) + 8);

    await page.goto(`/p/${projectId}`);
    await addTask(page, "Todo", "Lands this week");
    await setDue(page, sunday);
    await page.getByRole("button", { name: "Close task" }).click();

    await addTask(page, "Todo", "Lands next week");
    await setDue(page, nextTuesday);
    await page.getByRole("button", { name: "Close task" }).click();

    // Pick the property, then the operator, then the window. Each step on
    // its own writes nothing: a rule with no window is still a question.
    await page.getByTestId("filter-button").click();
    const search = page.getByTestId("filter-search");
    await search.fill("Due");
    await search.press("Enter");
    await page.getByRole("button", { name: "is within" }).click();
    await expect(page.getByTestId("filter-chip")).toHaveCount(0);
    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");

    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
      page.getByRole("option", { name: "This week" }).click(),
    );
    await page.keyboard.press("Escape");

    // The chip says it the way a person would, and the window holds.
    await expect(chip(page, "Due this week")).toBeVisible();
    await expect(card(page, "Lands this week")).toBeVisible();
    await expect(card(page, "Lands next week")).toHaveCount(0);
    await expect(page.getByTestId("task-count")).toHaveText("1 of 2 tasks");

    /* The rule is stored as the word, so a fresh read works the same week
       out again. This is the whole point: nothing was written down as a day. */
    await page.goto(`/p/${projectId}`);
    await expect(chip(page, "Due this week")).toBeVisible();
    await expect(card(page, "Lands this week")).toBeVisible();
    await expect(card(page, "Lands next week")).toHaveCount(0);

    // Overdue says its own name, because "Due is overdue" says it twice.
    await chip(page, "Due this week").click();
    const editor = page.getByTestId("filter-editor");
    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
      editor.getByRole("option", { name: "Overdue" }).click(),
    );
    await page.keyboard.press("Escape");
    await expect(chip(page, "Overdue")).toBeVisible();
    await expect(card(page, "Lands this week")).toHaveCount(0);

    /* The server drew this board and the browser drew it again from the same
       day. A mismatch would be a React error here and a board that flickers
       into different cards for everybody who is a zone away. */
    expect(noise).toEqual([]);
  });
});
