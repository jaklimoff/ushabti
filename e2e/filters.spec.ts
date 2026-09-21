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
  savedLens,
  settles,
  unique,
} from "./helpers";

type Page = import("@playwright/test").Page;

function chip(page: Page, text: string) {
  return page.getByTestId("filter-chip").filter({ hasText: text });
}

/**
 * A day in UTC, counted from today, as YYYY-MM-DD.
 *
 * The project below is set to UTC, so this is the day the board will call
 * today. It is worked out here in plain arithmetic for the same reason the
 * product does: the machine running the test is in some zone of its own.
 */
function utcDay(offset: number): string {
  const now = new Date();
  const at = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * 86_400_000,
  );
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return `${at.getUTCFullYear()}-${month}-${day}`;
}

/** How many days back the Monday of this UTC week is. The week starts Monday. */
function toMonday(): number {
  const weekday = new Date().getUTCDay();
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

test.describe("Filters inside a view", () => {
  test("a filter narrows the board and the count says by how much", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Filtering"));

    await addTask(page, "Todo", "Urgent thing");
    // The panel opens on the new task, so the priority goes on straight away.
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addTask(page, "Todo", "Ordinary thing");
    await page.getByRole("button", { name: "Close task" }).click();

    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");
    await expect(page.getByTestId("filter-row")).toHaveCount(0);

    await addFilter(page, "Priority", "Urgent");

    await expect(chip(page, "Priority is Urgent")).toBeVisible();
    await expect(card(page, "Urgent thing")).toBeVisible();
    await expect(card(page, "Ordinary thing")).toHaveCount(0);
    await expect(page.getByTestId("task-count")).toHaveText("1 of 2 tasks");
    await expect(page.getByTestId("filter-button")).toContainText("Filter 1");

    // The ✕ on the chip is how a rule goes.
    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
      page.getByRole("button", { name: "Remove the filter Priority is Urgent" }).click(),
    );
    await expect(card(page, "Ordinary thing")).toBeVisible();
    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");
    await expect(page.getByTestId("filter-row")).toHaveCount(0);
  });

  test("a rule can be changed from its own chip", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Changing"));

    await addTask(page, "Todo", "Urgent thing");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addTask(page, "Todo", "High thing");
    await page.getByRole("button", { name: "High", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(card(page, "High thing")).toHaveCount(0);

    await chip(page, "Priority is Urgent").click();
    const editor = page.getByTestId("filter-editor");
    await expect(editor).toBeVisible();

    // Adding High widens the rule, then dropping Urgent narrows it again.
    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
      editor.getByRole("option", { name: "High" }).click(),
    );
    await expect(card(page, "Urgent thing")).toBeVisible();
    await expect(card(page, "High thing")).toBeVisible();

    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
      editor.getByRole("option", { name: "Urgent" }).click(),
    );
    await expect(chip(page, "Priority is High")).toBeVisible();
    await expect(card(page, "Urgent thing")).toHaveCount(0);
  });

  test("a rule about the grouping property takes its columns with it", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Columns"));

    await addTask(page, "Todo", "Only task");
    await page.getByRole("button", { name: "Close task" }).click();

    for (const name of ["Backlog", "Todo", "Shipped"]) {
      await expect(column(page, name)).toBeVisible();
    }

    // The board groups by Status, so a rule about Status also speaks about the
    // columns. A column a card could not live in would be a trap to drop into.
    await addFilter(page, "Status", "Backlog");
    await expect(chip(page, "Status is Backlog")).toBeVisible();
    await expect(column(page, "Backlog")).toBeVisible();
    await expect(column(page, "Todo")).toHaveCount(0);
    await expect(column(page, "Shipped")).toHaveCount(0);

    // Nothing is in Backlog, so the board says so rather than looking broken.
    await expect(page.getByText("No task passes the filter")).toBeVisible();

    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
      page.getByTestId("filter-clear").click(),
    );
    await expect(column(page, "Todo")).toBeVisible();
    await expect(card(page, "Only task")).toBeVisible();
  });

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

  test("a task added under a filter is not hidden by it", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Adding"));

    await addTask(page, "Todo", "First task");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    // The composer says what it is about to write before it writes it.
    await page.getByRole("button", { name: "Add a task to the top of Todo" }).first().click();
    await expect(page.getByText("sets Priority Urgent")).toBeVisible();

    const box = page.getByPlaceholder("What needs doing?");
    await box.fill("Second task");
    await box.press("Enter");

    // Without the value the filter asks for, this card would be written and
    // hidden in the same breath.
    await expect(page.getByRole("button", { name: "Close task" })).toBeVisible();
    await page.getByRole("button", { name: "Close task" }).click();
    await expect(card(page, "Second task")).toBeVisible();
    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");
  });

  test("a new column joins the rule that would have hidden it", async ({ page }) => {
    await register(page);
    await createProject(page, unique("NewColumn"));

    await addFilter(page, "Status", "Backlog");
    await expect(chip(page, "Status is Backlog")).toBeVisible();
    await expect(column(page, "Todo")).toHaveCount(0);

    await page.getByRole("button", { name: "New column" }).click();
    const box = page.getByPlaceholder("Column name");
    await box.fill("Blocked");
    // The rule is mine, so the column joins my lens and the view is untouched.
    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () => box.press("Enter"));

    // Nobody makes a column in order not to see it.
    await expect(column(page, "Blocked")).toBeVisible();
    await expect(chip(page, "Status is Backlog, Blocked")).toBeVisible();
    await expect(page.getByTestId("filter-mine")).toBeVisible();
  });

  /* The same again where the rule is the team's. The column joins the view's
     set, for everybody, and nothing of mine is written. */
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

  /* This is the whole point of the two steps. */
  test("picking a property asks a question and hides nothing", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Asking"));

    await addTask(page, "Todo", "Urgent thing");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addTask(page, "Todo", "Ordinary thing");
    await page.getByRole("button", { name: "Close task" }).click();

    await page.getByTestId("filter-button").click();
    const search = page.getByTestId("filter-search");
    await search.fill("Priority");
    await search.press("Enter");

    // The board must not have guessed an answer. Nothing is hidden, no chip
    // exists, and the line is only holding its space open.
    await expect(page.getByTestId("filter-chip")).toHaveCount(0);
    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");
    await expect(card(page, "Ordinary thing")).toBeVisible();

    // The arrow keys walk the values; Enter takes the one under them.
    const box = page.getByTestId("filter-box");
    await expect(box).toBeFocused();
    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () => box.press("Enter"));
    await expect(chip(page, "Priority is Urgent")).toBeVisible();
    await expect(card(page, "Ordinary thing")).toHaveCount(0);

    // The panel stays open, because a set rule usually names more than one.
    await expect(page.getByTestId("filter-menu")).toBeVisible();
    await box.press("ArrowDown");
    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () => box.press("Enter"));
    await expect(chip(page, "Priority is Urgent, High")).toBeVisible();

    // ‹ goes back to the property list without touching the rule.
    await page.getByRole("button", { name: /Pick another property/ }).click();
    await expect(page.getByTestId("filter-search")).toBeVisible();
    await expect(chip(page, "Priority is Urgent, High")).toBeVisible();
  });

  test("a rule whose option is deleted goes with it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Deleting"));

    await addTask(page, "Todo", "Only task");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    await page.goto(`/p/${projectId}/settings/properties`);
    // An option goes at once. Only a whole property asks first.
    await settles(page, /\/api\/options\//, () =>
      page.getByRole("button", { name: "Delete the option Urgent" }).click(),
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

  test("a rule I add says it is mine, and one press makes it the view's", async ({ page }) => {
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
  });

  test("the view's chips come first, then a divider, then mine", async ({ page }) => {
    await register(page);
    await createProject(page, unique("BothSets"));

    await addTask(page, "Todo", "Urgent thing");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    // One rule on the view, for everybody.
    await addFilter(page, "Priority", "Urgent");
    await putFilterOnView(page);

    // One rule of my own on top of it.
    await addFilter(page, "Status", "Todo");
    await expect(page.getByTestId("filter-divider")).toBeVisible();
    await expect(page.getByTestId("filter-chip")).toHaveCount(2);

    // The view's first, mine after, because that is the order they are read in.
    const said = await page.getByTestId("filter-chip").allInnerTexts();
    expect(said.map((t) => t.trim())).toEqual(["Priority is Urgent", "Status is Todo"]);

    // Clear takes away mine and leaves the view's where it is.
    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
      page.getByTestId("filter-clear").click(),
    );
    await expect(page.getByTestId("filter-chip")).toHaveCount(1);
    await expect(chip(page, "Priority is Urgent")).toBeVisible();
    await expect(page.getByTestId("filter-divider")).toHaveCount(0);
  });

  test("removing a rule of the view asks in the chip first", async ({ page }) => {
    await register(page);
    await createProject(page, unique("AskingFirst"));

    await addTask(page, "Todo", "Urgent thing");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await putFilterOnView(page);

    const cross = page.getByRole("button", {
      name: "Remove the filter Priority is Urgent for everyone",
    });

    // The board has no dialogs: the chip becomes the question where it stands.
    await cross.click();
    await expect(page.getByText("Remove for everyone?")).toBeVisible();
    await expect(page.getByTestId("filter-chip-remove")).toBeFocused();

    // Escape puts the chip back, and the rule is still on the view.
    await page.keyboard.press("Escape");
    await expect(page.getByText("Remove for everyone?")).toHaveCount(0);
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    /* The question took the focus, so the chip takes it back. Without this it
       falls to the body and the next Tab starts at the top of the page. */
    await expect(cross).toBeFocused();

    // Which is why the keyboard alone can ask again.
    await page.keyboard.press("Enter");
    await expect(page.getByText("Remove for everyone?")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cross).toBeFocused();

    await cross.click();
    await settles(page, /\/api\/views\/[0-9a-f-]+$/, () =>
      page.getByTestId("filter-chip-remove").click(),
    );
    await expect(page.getByTestId("filter-row")).toHaveCount(0);
  });

  test("a task added under both sets is seeded for both", async ({ page }) => {
    await register(page);
    await createProject(page, unique("SeedBoth"));

    await addTask(page, "Todo", "First task");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await putFilterOnView(page);
    await addFilter(page, "Labels", "bug");

    // The composer names both, or the card is written and hidden at once.
    await page.getByRole("button", { name: "Add a task to the top of Todo" }).first().click();
    await expect(page.getByText("sets Priority Urgent, Labels bug")).toBeVisible();

    const box = page.getByPlaceholder("What needs doing?");
    await box.fill("Second task");
    await box.press("Enter");
    await page.getByRole("button", { name: "Close task" }).click();

    // The new card passes both sets. The first one never had a label, so my
    // own rule is hiding it — which is the rule doing its job.
    await expect(card(page, "Second task")).toBeVisible();
    await expect(card(page, "First task")).toHaveCount(0);
    await expect(page.getByTestId("task-count")).toHaveText("1 of 2 tasks");
  });

  /* One property, one rule. A second rule beside the view's would empty the
     board with two chips that fight each other, and say nothing about why. */
  test("a property the view already filters is refused where it is picked", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Clash"));

    await addTask(page, "Todo", "Urgent thing");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    // Priority is the view's now, so everybody on this board is asking it.
    await addFilter(page, "Priority", "Urgent");
    await putFilterOnView(page);

    // Nothing of mine may be written while the panel says no.
    let wrote = 0;
    page.on("request", (req) => {
      if (/\/api\/views\/[0-9a-f-]+\/lens/.test(req.url())) wrote += 1;
    });

    await page.getByTestId("filter-button").click();
    const search = page.getByTestId("filter-search");
    await search.fill("Priority");
    await search.press("Enter");

    await expect(page.getByTestId("filter-refused")).toHaveText(
      "The view already filters Priority. Remove it for everyone first.",
    );
    // The panel did not move on: there is nothing to answer with.
    await expect(page.getByTestId("filter-box")).toHaveCount(0);
    // The view's one chip, and nothing of mine anywhere.
    await expect(page.getByTestId("filter-chip")).toHaveCount(1);
    await expect(page.getByTestId("filter-mine")).toHaveCount(0);
    await expect(page.getByTestId("filter-button")).toContainText("Filter 1");
    expect(wrote).toBe(0);

    // Another property is still one press away, and the line goes with it.
    await search.fill("Status");
    await expect(page.getByTestId("filter-refused")).toHaveCount(0);
    await search.press("Enter");
    await expect(page.getByTestId("filter-box")).toBeVisible();
  });

  /* The panel cannot see a clash that arrives after my rule does: somebody
     else puts that property on the view while I hold mine. So the door the
     team comes through says it again, and writes nothing. */
  test("Put on the view refuses a rule about a property the view filters", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("PromoteClash"));

    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const view = board.views[0];
    const priority = board.properties.find((p: { name: string }) => p.name === "Priority");
    const key = (name: string) =>
      priority.options.find((o: { name: string }) => o.name === name).id;

    const ofView = { propertyId: priority.id, op: "is", values: [key("Urgent")] };
    const mine = { propertyId: priority.id, op: "is", values: [key("High")] };

    /* Mine goes on first, when the view asks nothing and there is no clash to
       see. The view takes that property afterwards, which is the one way the
       two sets can ever hold one property: both doors refuse it from now on. */
    const saved = await page.request.put(`/api/views/${view.id}/lens`, {
      data: { filters: { rules: [mine] } },
    });
    expect(saved.ok()).toBeTruthy();
    await page.request.patch(`/api/views/${view.id}`, { data: { filters: { rules: [ofView] } } });

    const promoted = await page.request.post(`/api/views/${view.id}/lens/promote`);
    expect(promoted.status()).toBe(409);
    expect((await promoted.json()).error).toBe(
      "The view already filters Priority. Remove it for everyone first.",
    );

    // Nothing moved: the view keeps its one rule, and mine is still mine.
    const after = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const kept = after.views.find((v: { id: string }) => v.id === view.id);
    expect(kept.filters.rules).toEqual([ofView]);
    expect(kept.lens.rules).toEqual([mine]);
  });

  /* A refused promote must not move the board first. The board it would draw
     is the contradicting one the refusal exists to prevent, so this one write
     waits for the answer. */
  test("a refused Put on the view says so and the board holds still", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("PromoteRefusedUI"));

    await addTask(page, "Todo", "Urgent thing");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const view = board.views[0];
    const priority = board.properties.find((p: { name: string }) => p.name === "Priority");
    const high = priority.options.find((o: { name: string }) => o.name === "High").id;

    /* This screen must not learn what the view has just been given, or it
       would refuse the press itself. That is the race the route is there for:
       somebody else names my property while I am holding a rule about it. */
    const boardRead = /\/api\/projects\/[0-9a-f-]+\/board/;
    await page.route(boardRead, (r) => r.abort());
    await page.request.patch(`/api/views/${view.id}`, {
      data: { filters: { rules: [{ propertyId: priority.id, op: "is", values: [high] }] } },
    });

    await settles(page, /\/api\/views\/[0-9a-f-]+\/lens\/promote$/, () =>
      page.getByTestId("filter-promote").click(),
    );

    await expect(page.getByTestId("toast")).toHaveText(
      "The view already filters Priority. Remove it for everyone first.",
    );
    // Nothing moved. The rule is still mine, and the press is still there.
    await expect(page.getByTestId("filter-mine")).toBeVisible();
    await expect(page.getByTestId("filter-promote")).toBeVisible();
    await expect(page.getByTestId("filter-chip")).toHaveCount(1);
    await expect(chip(page, "Priority is Urgent")).toBeVisible();
    await expect(card(page, "Urgent thing")).toBeVisible();

    // And once this screen can see the clash, the press costs no round trip.
    await page.unroute(boardRead);
    let asked = 0;
    page.on("request", (req) => {
      if (/\/lens\/promote$/.test(new URL(req.url()).pathname)) asked += 1;
    });
    await page.goto(`/p/${projectId}`);
    await expect(page.getByTestId("filter-divider")).toBeVisible();

    await page.getByTestId("filter-promote").click();
    await expect(page.getByTestId("toast")).toHaveText(
      "The view already filters Priority. Remove it for everyone first.",
    );
    expect(asked).toBe(0);
  });

  /* The panel is not the only way a lens is written. The route is the other
     door, and it says the same sentence. */
  test("writing a lens refuses a property the view already filters", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("LensClash"));

    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const view = board.views[0];
    const priority = board.properties.find((p: { name: string }) => p.name === "Priority");
    const key = (name: string) =>
      priority.options.find((o: { name: string }) => o.name === name).id;

    const ofView = { propertyId: priority.id, op: "is", values: [key("Urgent")] };
    const mine = { propertyId: priority.id, op: "is", values: [key("High")] };

    await page.request.patch(`/api/views/${view.id}`, { data: { filters: { rules: [ofView] } } });

    const refused = await page.request.put(`/api/views/${view.id}/lens`, {
      data: { filters: { rules: [mine] } },
    });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error).toBe(
      "The view already filters Priority. Remove it for everyone first.",
    );

    // Nothing was written, so there is no second rule waiting to be promoted.
    expect(await savedLens(view.id)).toBeNull();

    // Another property is still mine to ask about.
    const status = board.properties.find((p: { name: string }) => p.name === "Status");
    const todo = status.options.find((o: { name: string }) => o.name === "Todo").id;
    const ok = await page.request.put(`/api/views/${view.id}/lens`, {
      data: { filters: { rules: [{ propertyId: status.id, op: "is", values: [todo] }] } },
    });
    expect(ok.ok()).toBeTruthy();
  });

  /* ---------------------------------------------------------------- */
  /* Read afresh, on the way in and on the way out                     */
  /* ---------------------------------------------------------------- */

  /* A lens is saved once and read for months, so it outlives what it names.
     Both readings are here: the one on the write, and the one the board does. */
  test("a lens drops a rule that names nothing, written and read alike", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("LensAfresh"));

    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const view = board.views[0];
    const priority = board.properties.find((p: { name: string }) => p.name === "Priority");
    const urgent = priority.options.find((o: { name: string }) => o.name === "Urgent").id;

    // A property that is gone, an option that is gone, and one live rule.
    const written = await page.request.put(`/api/views/${view.id}/lens`, {
      data: {
        filters: {
          rules: [
            { propertyId: "11111111-1111-1111-1111-111111111111", op: "is", values: ["nothing"] },
            { propertyId: priority.id, op: "is", values: [urgent, "22222222-gone"] },
          ],
        },
      },
    });
    expect(written.ok()).toBeTruthy();

    // The write read them first, so the row itself holds only what can be read.
    expect(await savedLens(view.id)).toEqual({
      rules: [{ propertyId: priority.id, op: "is", values: [urgent] }],
    });

    // The board says the same, because it reads the row afresh again.
    const withLens = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    expect(withLens.views.find((v: { id: string }) => v.id === view.id).lens.rules).toEqual([
      { propertyId: priority.id, op: "is", values: [urgent] },
    ]);

    // Now the option goes, under a lens nobody rewrites. The row still names
    // it; the board must not, or a rule nobody can see keeps hiding cards.
    const option = await page.request.delete(`/api/options/${urgent}`);
    expect(option.ok()).toBeTruthy();
    expect((await savedLens(view.id))?.rules).toHaveLength(1);

    const after = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    expect(after.views.find((v: { id: string }) => v.id === view.id).lens.rules).toEqual([]);
  });
});

/* On a phone the row has no room to wrap, so it scrolls sideways and the tail
   shortens. Nothing about the rules changes with the width. */
test.describe("Filters on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("the chips scroll sideways and the tail is short", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Phone"));

    await addTask(page, "Todo", "Urgent thing");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");

    await expect(page.getByText("Only you ·")).toBeVisible();
    await expect(page.getByText("Put on view")).toBeVisible();
    await expect(page.getByText("Only you see this")).toBeHidden();

    // One line of chips, however many there are: the row scrolls instead.
    const row = page.getByTestId("filter-row");
    const height = await row.evaluate((el) => el.clientHeight);
    await addFilter(page, "Status", "Todo");
    await addFilter(page, "Labels", "bug");
    expect(await row.evaluate((el) => el.clientHeight)).toBe(height);
    expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});

/*
 * The browser is a day ahead of the project on purpose.
 *
 * At most hours of the UTC day it is already tomorrow in Auckland, so a board
 * that worked a window out from this browser's clock would draw one set of
 * cards on the server and another after it hydrated. Everything below has to
 * hold anyway, and the console has to stay clean.
 */
test.describe("A date rule that names a window of days", () => {
  test.use({ timezoneId: "Pacific/Auckland" });

  test("holds a week still, and reads the same after a reload", async ({ page }) => {
    const noise: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") noise.push(message.text());
    });
    page.on("pageerror", (error) => noise.push(error.message));

    await register(page);
    const projectId = await createProject(page, unique("Windows"));

    /* The zone is the project's, and the owner says which. UTC is where a
       project starts, so this write proves the row rather than moving it. */
    await gotoSettings(page, projectId, "project");
    const zone = page.getByLabel("The time zone this project's day is worked out in");
    await expect(zone).toHaveValue("UTC");

    // A name this server does not know is refused in one line, and nothing
    // is saved: a zone that quietly became UTC would move every card.
    await zone.fill("Europe/Atlantis");
    await zone.blur();
    await expect(page.getByTestId("toast")).toContainText("No time zone is called Europe/Atlantis");
    await page.reload();
    await expect(zone).toHaveValue("UTC");
    /* That 400 is the refusal we asked for. Everything the board says from
       here on has to be quiet. */
    noise.length = 0;

    const sunday = utcDay(toMonday() + 6);
    const nextTuesday = utcDay(toMonday() + 8);

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
