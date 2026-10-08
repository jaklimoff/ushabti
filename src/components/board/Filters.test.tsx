import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import type { BoardData, FilterRule } from "@/lib/types";
import {
  newProject,
  optionOf,
  propertyOf,
  renderWithBoard,
  withTask,
  type Answer,
  type Sent,
} from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * What the filter strip and its panel draw for a set of rules, and what a
 * press sends. Each test here was a test of `e2e/filters.spec.ts`, and its
 * name is the name it had there. The ones that need a reload, a second tab or
 * the server's own reading stayed there.
 */

const LENS = /^\/api\/views\/[0-9a-f-]+\/lens$/;
const VIEW = /^\/api\/views\/[0-9a-f-]+$/;
const PROMOTE = /^\/api\/views\/[0-9a-f-]+\/lens\/promote$/;
const CLASH = "The view already filters Priority. Remove it for everyone first.";

const MADE_TASK = "00000000-0000-4000-8000-999999999999";
const MADE_OPTION = "00000000-0000-4000-8000-888888888888";

/* What a filtered board writes that needs a row back: a new task, which then
   opens its panel, and a new column. Everything else answers `{}`. */
function writes(): Answer {
  let made: Record<string, unknown> | null = null;
  return ({ method, path, body }) => {
    if (method === "POST" && /\/tasks$/.test(path)) {
      const sent = body as { title: string; values: Record<string, string> };
      made = {
        id: MADE_TASK,
        number: 99,
        key: "TST-99",
        title: sent.title,
        description: "",
        position: "a0000000",
        createdAt: "2026-10-08T10:00:00.000Z",
        updatedAt: "2026-10-08T10:00:00.000Z",
        values: sent.values,
      };
      return { body: { task: made } };
    }
    if (method === "GET" && path === `/api/tasks/${MADE_TASK}` && made) {
      const detail = {
        ...made,
        archivedAt: null,
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        blockedBy: [],
        parts: null,
        creator: null,
        links: { blockedBy: [], blocks: [] },
        parent: null,
        children: [],
        checklist: [],
        comments: [],
        activity: [],
        run: null,
        pastRuns: [],
        pastRunsTotal: 0,
        attachments: [],
      };
      return { body: { task: detail } };
    }
    if (method === "POST" && /\/options$/.test(path)) {
      const { name } = body as { name: string };
      return {
        body: {
          option: {
            id: MADE_OPTION,
            name,
            color: "#6b7280",
            position: "z0000000",
            startAt: null,
            targetAt: null,
            shippedAt: null,
            note: null,
          },
        },
      };
    }
  };
}

async function draw(data: BoardData, answer: Answer = writes()) {
  const drawn = await renderWithBoard(<BoardShell initialTask={null} />, data, answer);
  return { ...drawn, lensWrites: () => drawn.sent("PUT", LENS) };
}

const byTestId = (id: string) => page.getByTestId(id);
const chip = (text: string) => byTestId("filter-chip").filter({ hasText: text });
const card = (title: string) => byTestId("card").filter({ hasText: title });
const column = (name: string) =>
  byTestId("column").filter({
    has: byTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/** What the last write of one kind sent as its rules. */
function rulesOf(sent: Sent[]): FilterRule[] {
  return (sent.at(-1)?.body as { filters: { rules: FilterRule[] } }).filters.rules;
}

/** Waits until `count` writes of a kind have gone out. */
async function wrote(writes: () => Sent[], count: number) {
  await expect.poll(() => writes().length).toBe(count);
}

/* The e2e helper `addFilter`: property, value, Enter, Escape. */
async function addFilter(property: string, value: string) {
  await byTestId("filter-button").click();
  await byTestId("filter-search").fill(property);
  await userEvent.keyboard("{Enter}");
  await byTestId("filter-box").fill(value);
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard("{Escape}");
  await gone(byTestId("filter-menu"));
}

/** A rule as the board stores it: an option set, named by option names. */
function rule(data: BoardData, property: string, ...names: string[]): FilterRule {
  return {
    propertyId: propertyOf(data, property).id,
    op: "is",
    values: names.map((n) => optionOf(data, property, n)),
  };
}

describe("Filters inside a view", () => {
  test("a filter narrows the board and the count says by how much", async () => {
    const data = newProject();
    withTask(data, "Urgent thing", { Status: "Todo", Priority: "Urgent" });
    withTask(data, "Ordinary thing", { Status: "Todo" });
    const { lensWrites } = await draw(data);

    await expect.element(byTestId("task-count")).toHaveTextContent("2 tasks");
    await gone(byTestId("filter-row"));

    await addFilter("Priority", "Urgent");
    await wrote(lensWrites, 1);

    await expect.element(chip("Priority is Urgent")).toBeVisible();
    await expect.element(card("Urgent thing")).toBeVisible();
    await gone(card("Ordinary thing"));
    await expect.element(byTestId("task-count")).toHaveTextContent("1 of 2 tasks");
    await expect.element(byTestId("filter-button")).toHaveTextContent("Filter 1");

    // The ✕ on the chip is how a rule goes.
    await page.getByRole("button", { name: "Remove the filter Priority is Urgent" }).click();
    await wrote(lensWrites, 2);
    expect(rulesOf(lensWrites())).toEqual([]);
    await expect.element(card("Ordinary thing")).toBeVisible();
    await expect.element(byTestId("task-count")).toHaveTextContent("2 tasks");
    await gone(byTestId("filter-row"));
  });

  test("a rule can be changed from its own chip", async () => {
    const data = newProject();
    withTask(data, "Urgent thing", { Status: "Todo", Priority: "Urgent" });
    withTask(data, "High thing", { Status: "Todo", Priority: "High" });
    const { lensWrites } = await draw(data);

    await addFilter("Priority", "Urgent");
    await gone(card("High thing"));

    await chip("Priority is Urgent").click();
    const editor = byTestId("filter-editor");
    await expect.element(editor).toBeVisible();

    // Adding High widens the rule, then dropping Urgent narrows it again.
    await editor.getByRole("option", { name: "High" }).click();
    await wrote(lensWrites, 2);
    await expect.element(card("Urgent thing")).toBeVisible();
    await expect.element(card("High thing")).toBeVisible();

    await editor.getByRole("option", { name: "Urgent" }).click();
    await wrote(lensWrites, 3);
    expect(rulesOf(lensWrites())).toEqual([rule(data, "Priority", "High")]);
    await expect.element(chip("Priority is High")).toBeVisible();
    await gone(card("Urgent thing"));
  });

  test("a rule about the grouping property takes its columns with it", async () => {
    const data = newProject();
    withTask(data, "Only task", { Status: "Todo" });
    const { lensWrites } = await draw(data);

    for (const name of ["Backlog", "Todo", "Shipped"]) {
      await expect.element(column(name)).toBeVisible();
    }

    // The board groups by Status, so a rule about Status also speaks about the
    // columns. A column a card could not live in would be a trap to drop into.
    await addFilter("Status", "Backlog");
    await expect.element(chip("Status is Backlog")).toBeVisible();
    await expect.element(column("Backlog")).toBeVisible();
    await gone(column("Todo"));
    await gone(column("Shipped"));

    // Nothing is in Backlog, so the board says so rather than looking broken.
    await expect.element(page.getByText("No task passes the filter")).toBeVisible();

    await byTestId("filter-clear").click();
    await wrote(lensWrites, 2);
    await expect.element(column("Todo")).toBeVisible();
    await expect.element(card("Only task")).toBeVisible();
  });

  test("a task added under a filter is not hidden by it", async () => {
    const data = newProject();
    withTask(data, "First task", { Status: "Todo", Priority: "Urgent" });
    const { sent } = await draw(data);

    await addFilter("Priority", "Urgent");
    await expect.element(chip("Priority is Urgent")).toBeVisible();

    // The composer says what it is about to write before it writes it.
    await page.getByRole("button", { name: "Add a task to the top of Todo" }).first().click();
    await expect.element(page.getByText("sets Priority Urgent")).toBeVisible();

    await page.getByPlaceholder("What needs doing?").fill("Second task");
    await userEvent.keyboard("{Enter}");

    // Without the value the filter asks for, this card would be written and
    // hidden in the same breath.
    await expect.poll(() => sent("POST", /\/tasks$/).length).toBe(1);
    const values = (sent("POST", /\/tasks$/)[0].body as { values: Record<string, string> }).values;
    expect(values[propertyOf(data, "Priority").id]).toBe(optionOf(data, "Priority", "Urgent"));

    await page.getByRole("button", { name: "Close task" }).click();
    await expect.element(card("Second task")).toBeVisible();
    await expect.element(byTestId("task-count")).toHaveTextContent("2 tasks");
  });

  test("a new column joins the rule that would have hidden it", async () => {
    const data = newProject();
    const { lensWrites, sent } = await draw(data);

    await addFilter("Status", "Backlog");
    await expect.element(chip("Status is Backlog")).toBeVisible();
    await gone(column("Todo"));

    await page.getByRole("button", { name: "New column" }).click();
    await page.getByPlaceholder("Column name").fill("Blocked");
    // The rule is mine, so the column joins my lens and the view is untouched.
    await userEvent.keyboard("{Enter}");
    await wrote(lensWrites, 2);
    expect(rulesOf(lensWrites())[0].values).toEqual([
      optionOf(data, "Status", "Backlog"),
      MADE_OPTION,
    ]);
    expect(sent("PATCH", VIEW)).toEqual([]);

    // Nobody makes a column in order not to see it.
    await expect.element(column("Blocked")).toBeVisible();
    await expect.element(chip("Status is Backlog, Blocked")).toBeVisible();
    await expect.element(byTestId("filter-mine")).toBeVisible();
  });

  /* This is the whole point of the two steps. */
  test("picking a property asks a question and hides nothing", async () => {
    const data = newProject();
    withTask(data, "Urgent thing", { Status: "Todo", Priority: "Urgent" });
    withTask(data, "Ordinary thing", { Status: "Todo" });
    const { lensWrites } = await draw(data);

    await byTestId("filter-button").click();
    await byTestId("filter-search").fill("Priority");
    await userEvent.keyboard("{Enter}");

    // The board must not have guessed an answer. Nothing is hidden, no chip
    // exists, and the line is only holding its space open.
    await gone(byTestId("filter-chip"));
    await expect.element(byTestId("task-count")).toHaveTextContent("2 tasks");
    await expect.element(card("Ordinary thing")).toBeVisible();
    expect(lensWrites()).toEqual([]);

    // The arrow keys walk the values; Enter takes the one under them.
    const box = byTestId("filter-box");
    await expect.element(box).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await wrote(lensWrites, 1);
    await expect.element(chip("Priority is Urgent")).toBeVisible();
    await gone(card("Ordinary thing"));

    // The panel stays open, because a set rule usually names more than one.
    await expect.element(byTestId("filter-menu")).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await wrote(lensWrites, 2);
    await expect.element(chip("Priority is Urgent, High")).toBeVisible();

    // ‹ goes back to the property list without touching the rule.
    await page.getByRole("button", { name: /Choose another property/ }).click();
    await expect.element(byTestId("filter-search")).toBeVisible();
    await expect.element(chip("Priority is Urgent, High")).toBeVisible();
    expect(lensWrites()).toHaveLength(2);
  });

  /* ---------------------------------------------------------------- */
  /* Yours, and the view's                                             */
  /* ---------------------------------------------------------------- */

  test("the view's chips come first, then a divider, then mine", async () => {
    const data = newProject();
    withTask(data, "Urgent thing", { Status: "Todo", Priority: "Urgent" });
    // One rule on the view, for everybody.
    data.views[0].filters = { rules: [rule(data, "Priority", "Urgent")] };
    const { lensWrites } = await draw(data);

    // One rule of my own on top of it.
    await addFilter("Status", "Todo");
    await expect.element(byTestId("filter-divider")).toBeVisible();
    await expect.poll(() => byTestId("filter-chip").elements().length).toBe(2);

    // The view's first, mine after, because that is the order they are read in.
    const said = byTestId("filter-chip")
      .elements()
      .map((el) => el.textContent?.trim());
    expect(said).toEqual(["Priority is Urgent", "Status is Todo"]);

    // Clear takes away mine and leaves the view's where it is.
    await byTestId("filter-clear").click();
    await wrote(lensWrites, 2);
    expect(rulesOf(lensWrites())).toEqual([]);
    await expect.poll(() => byTestId("filter-chip").elements().length).toBe(1);
    await expect.element(chip("Priority is Urgent")).toBeVisible();
    await gone(byTestId("filter-divider"));
  });

  test("the panel of a view's chip says a change is for everyone", async () => {
    const data = newProject();
    data.views[0].filters = { rules: [rule(data, "Priority", "Urgent")] };
    data.views[0].lens = { rules: [rule(data, "Status", "Todo")] };
    await draw(data);

    const editor = byTestId("filter-editor");

    // The view's rule is everybody's, so its panel says so before anything changes.
    await chip("Priority is Urgent").click();
    await expect.element(editor).toBeVisible();
    await expect
      .element(editor.getByTestId("filter-editor-shared"))
      .toHaveTextContent("Changes this for everyone");
    // A line, not a question: nothing is asked and nothing is written yet.
    await gone(page.getByRole("alertdialog"));
    await gone(page.getByRole("dialog"));
    await userEvent.keyboard("{Escape}");
    await gone(editor);

    // Mine is mine alone, so its panel says nothing extra.
    await chip("Status is Todo").click();
    await expect.element(editor).toBeVisible();
    await gone(byTestId("filter-editor-shared"));
  });

  test("removing a rule of the view asks in the chip first", async () => {
    const data = newProject();
    withTask(data, "Urgent thing", { Status: "Todo", Priority: "Urgent" });
    data.views[0].filters = { rules: [rule(data, "Priority", "Urgent")] };
    const { sent } = await draw(data);

    const cross = page.getByRole("button", {
      name: "Remove the filter Priority is Urgent for everyone",
      exact: true,
    });

    // The board has no dialogs: the chip becomes the question where it stands.
    await cross.click();
    await expect.element(page.getByText("Remove for everyone?")).toBeVisible();
    await expect.element(byTestId("filter-chip-remove")).toHaveFocus();

    // Escape puts the chip back, and the rule is still on the view.
    await userEvent.keyboard("{Escape}");
    await gone(page.getByText("Remove for everyone?"));
    await expect.element(chip("Priority is Urgent")).toBeVisible();

    /* The question took the focus, so the chip takes it back. Without this it
       falls to the body and the next Tab starts at the top of the page. */
    await expect.element(cross).toHaveFocus();

    // Which is why the keyboard alone can ask again.
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("Remove for everyone?")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(cross).toHaveFocus();
    expect(sent("PATCH", VIEW)).toEqual([]);

    await cross.click();
    await byTestId("filter-chip-remove").click();
    await expect.poll(() => sent("PATCH", VIEW).length).toBe(1);
    expect(sent("PATCH", VIEW)[0].body).toEqual({ filters: { rules: [] } });
    await gone(byTestId("filter-row"));
  });

  test("a task added under both sets is seeded for both", async () => {
    const data = newProject();
    withTask(data, "First task", { Status: "Todo", Priority: "Urgent" });
    data.views[0].filters = { rules: [rule(data, "Priority", "Urgent")] };
    const { sent } = await draw(data);

    await addFilter("Labels", "bug");

    // The composer names both, or the card is written and hidden at once.
    await page.getByRole("button", { name: "Add a task to the top of Todo" }).first().click();
    await expect.element(page.getByText("sets Priority Urgent, Labels bug")).toBeVisible();

    await page.getByPlaceholder("What needs doing?").fill("Second task");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => sent("POST", /\/tasks$/).length).toBe(1);
    const values = (sent("POST", /\/tasks$/)[0].body as { values: Record<string, unknown> }).values;
    expect(values[propertyOf(data, "Priority").id]).toBe(optionOf(data, "Priority", "Urgent"));
    expect(values[propertyOf(data, "Labels").id]).toEqual([optionOf(data, "Labels", "bug")]);
    await page.getByRole("button", { name: "Close task" }).click();

    // The new card passes both sets. The first one never had a label, so my
    // own rule is hiding it — which is the rule doing its job.
    await expect.element(card("Second task")).toBeVisible();
    await gone(card("First task"));
    await expect.element(byTestId("task-count")).toHaveTextContent("1 of 2 tasks");
  });

  /* One property, one rule. A second rule beside the view's would empty the
     board with two chips that fight each other, and say nothing about why. */
  test("a property the view already filters is refused where it is picked", async () => {
    const data = newProject();
    withTask(data, "Urgent thing", { Status: "Todo", Priority: "Urgent" });
    // Priority is the view's, so everybody on this board is asking it.
    data.views[0].filters = { rules: [rule(data, "Priority", "Urgent")] };
    const { sent } = await draw(data);

    await byTestId("filter-button").click();
    const search = byTestId("filter-search");
    await search.fill("Priority");
    await userEvent.keyboard("{Enter}");

    await expect.element(byTestId("filter-refused")).toHaveTextContent(CLASH);
    // The panel did not move on: there is nothing to answer with.
    await gone(byTestId("filter-box"));
    // The view's one chip, and nothing of mine anywhere.
    await expect.poll(() => byTestId("filter-chip").elements().length).toBe(1);
    await gone(byTestId("filter-mine"));
    await expect.element(byTestId("filter-button")).toHaveTextContent("Filter 1");
    // Nothing of mine may be written while the panel says no.
    expect(sent(undefined, /\/lens/)).toEqual([]);

    // Another property is still one press away, and the line goes with it.
    await search.fill("Status");
    await gone(byTestId("filter-refused"));
    await userEvent.keyboard("{Enter}");
    await expect.element(byTestId("filter-box")).toBeVisible();
  });

  /* A refused promote must not move the board first. The board it would draw
     is the contradicting one the refusal exists to prevent, so this one write
     waits for the answer. This screen never learns that somebody else gave
     the view my property, which is the race the route is there for. */
  test("a refused Save for everyone says so and the board holds still", async () => {
    const data = newProject();
    withTask(data, "Urgent thing", { Status: "Todo", Priority: "Urgent" });
    data.views[0].lens = { rules: [rule(data, "Priority", "Urgent")] };
    const { sent } = await draw(data, (req) =>
      PROMOTE.test(req.path) ? { status: 409, body: { error: CLASH } } : undefined,
    );

    await byTestId("filter-promote").click();
    await expect.poll(() => sent("POST", PROMOTE).length).toBe(1);

    await expect.element(byTestId("toast")).toHaveTextContent(CLASH);
    // Nothing moved. The rule is still mine, and the press is still there.
    await expect.element(byTestId("filter-mine")).toBeVisible();
    await expect.element(byTestId("filter-promote")).toBeVisible();
    await expect.poll(() => byTestId("filter-chip").elements().length).toBe(1);
    await expect.element(chip("Priority is Urgent")).toBeVisible();
    await expect.element(card("Urgent thing")).toBeVisible();
  });

  /* The second half of the e2e test of the same name: once this screen can
     see the clash, the press costs no round trip. */
  test("a refused Save for everyone costs no round trip once the clash is on screen", async () => {
    const data = newProject();
    data.views[0].filters = { rules: [rule(data, "Priority", "High")] };
    data.views[0].lens = { rules: [rule(data, "Priority", "Urgent")] };
    const { sent } = await draw(data);

    await expect.element(byTestId("filter-divider")).toBeVisible();
    await byTestId("filter-promote").click();
    await expect.element(byTestId("toast")).toHaveTextContent(CLASH);
    expect(sent("POST", PROMOTE)).toEqual([]);
  });
});

/* On a phone the row has no room to wrap, so it scrolls sideways and the tail
   shortens. Nothing about the rules changes with the width. */
describe("Filters on a phone", () => {
  test("the chips scroll sideways and the tail is short", async () => {
    await page.viewport(390, 780);
    try {
      const data = newProject();
      withTask(data, "Urgent thing", { Status: "Todo", Priority: "Urgent" });
      await draw(data);

      await addFilter("Priority", "Urgent");

      await expect.element(page.getByText("Only you ·")).toBeVisible();
      await expect.element(page.getByText("Save for all")).toBeVisible();
      await expect.element(page.getByText("Only you see this")).not.toBeVisible();

      // One line of chips, however many there are: the row scrolls instead.
      const row = byTestId("filter-row").element();
      const height = row.clientHeight;
      await addFilter("Status", "Todo");
      await addFilter("Labels", "bug");
      await expect.poll(() => byTestId("filter-chip").elements().length).toBe(3);
      expect(row.clientHeight).toBe(height);
      expect(row.scrollWidth > row.clientWidth).toBe(true);
    } finally {
      await page.viewport(1440, 900);
    }
  });
});
