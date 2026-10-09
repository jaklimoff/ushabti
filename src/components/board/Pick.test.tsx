import { afterEach, describe, expect, test } from "vitest";
import { commands, page, userEvent, type Locator } from "vitest/browser";
import type { BoardData } from "@/lib/types";
import {
  ME,
  newProject,
  optionOf,
  propertyOf,
  renderWithBoard,
  withTask,
  type Answer,
  type Drawing,
} from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * Picking several cards, and what the bar does with them. Each test here was
 * a test of `e2e/pick.spec.ts`, `e2e/pick-labels.spec.ts` or
 * `e2e/words.spec.ts`, and its name is the name it had there. One Set on
 * several cards stayed end to end, through to a reload. Who may archive is
 * the route's, in `pick-route.test.ts`.
 */

const BULK = /^\/api\/projects\/[0-9a-f-]+\/tasks\/values$/;
const ARCHIVE = /^\/api\/projects\/[0-9a-f-]+\/archive$/;
const LIST_ID = "00000000-0000-4000-8000-777777777777";

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const check = (title: string) => card(title).getByTestId("card-pick");
const column = (name: string) =>
  byTestId("column").filter({
    has: byTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });
const listRow = (title: string) => byTestId("list-row").filter({ hasText: title });
/** How many cards wear the border of a pick, in `within` or on the whole board. */
const pickedCount = (within: Element = document.body) =>
  within.querySelectorAll('[data-testid="card"][data-picked="true"]').length;
/** The one element that matches `css`, as a locator. */
const css = (selector: string) => page.elementLocator(document.querySelector(selector)!);
const shift = { modifiers: ["Shift"] } as never;

/** The titles of one column's cards, top to bottom. */
const columnOrder = (name: string) =>
  column(name)
    .getByTestId("card-title")
    .elements()
    .map((el) => el.textContent?.trim() ?? "");

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/** What the browser thinks is selected, which after a Shift-click is nothing. */
const selectedText = () => window.getSelection()?.toString() ?? "";

/** How far the page can be pushed sideways. A phone has nowhere to push it. */
function overflow(): number {
  const doc = document.documentElement;
  return Math.max(doc.scrollWidth - doc.clientWidth, 0);
}

/**
 * The right edge of the last thing on the top bar that takes any room. The
 * shell hides its own overflow, so a bar that is too long is clipped in
 * silence; measuring the end is the only way to see it.
 */
function topBarEnds(): number {
  const top = document.querySelector('[data-testid="top-bar"]')!;
  const drawn = [...top.children].filter((el) => el.getBoundingClientRect().width > 0);
  return Math.round(drawn[drawn.length - 1].getBoundingClientRect().right);
}

/** Three cards in Todo, and one in Backlog that is picked by nothing. */
function fourCards(data: BoardData) {
  for (const title of ["Aardvark", "Beetle", "Cricket"]) withTask(data, title, { Status: "Todo" });
  withTask(data, "Dingo", { Status: "Backlog" });
}

/** A list view called `name`, which the board opens on. */
function withList(data: BoardData, name: string) {
  for (const view of data.views) view.isDefault = false;
  data.views.push({
    ...data.views[0],
    id: LIST_ID,
    name,
    kind: "list",
    position: "z0000000",
    isDefault: true,
  });
}

async function draw(data: BoardData, refuse?: Answer, drawing: Drawing = {}) {
  const server = serving(data, drawing.user);
  const answer: Answer = (sent) => refuse?.(sent) ?? server.answer(sent);
  const drawn = await renderWithBoard(<BoardShell initialTask={null} />, data, answer, drawing);
  return { ...drawn, server: server.server };
}

async function pick(...titles: string[]) {
  for (const title of titles) await check(title).click();
}

/** The element's words hold `text`. `toHaveTextContent` asks for all of them. */
async function says(locator: Locator, text: string) {
  await expect.poll(() => locator.element().textContent ?? "").toContain(text);
}

async function count(text: string) {
  await expect.element(byTestId("pick-count")).toHaveTextContent(text);
}

/** Opens Set and the property named, as the e2e helper did. */
async function setProperty(property: string) {
  await byTestId("pick-set").click();
  await byTestId("pick-search").fill(property);
  await userEvent.keyboard("{Enter}");
}

afterEach(async () => {
  await commands.touch(false);
  await page.viewport(1440, 900);
});

describe("Picking several cards", () => {
  test("Set on Assignee finds a person by typing", async () => {
    const data = newProject();
    fourCards(data);
    const { sent, server } = await draw(data);
    await pick("Aardvark", "Beetle");

    await setProperty("Assignee");
    const menu = byTestId("pick-menu");
    await menu.getByRole("button", { name: "Unassigned" }).click();

    /* The box has the focus, and the reader is highlighted on an empty field. */
    const find = menu.getByRole("combobox", { name: "Find a person" });
    await expect.element(find).toHaveFocus();
    await expect
      .element(menu.getByRole("option").filter({ hasText: ME.name }))
      .toHaveAttribute("data-at", "true");

    await find.fill("ada");
    await gone(menu.getByRole("option", { name: "Unassigned" }));
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => sent("POST", BULK).length).toBe(1);
    await userEvent.keyboard("{Escape}");

    for (const title of ["Aardvark", "Beetle"]) {
      await expect.element(card(title).getByTitle(ME.name, { exact: true })).toBeVisible();
    }
    await gone(card("Cricket").getByTitle(ME.name, { exact: true }));
    const assignee = propertyOf(data, "Assignee").id;
    expect(server.tasks.filter((t) => t.values[assignee] === ME.id).map((t) => t.title)).toEqual([
      "Aardvark",
      "Beetle",
    ]);
  });

  test("Escape ends it, and so does the ✕", async () => {
    const data = newProject();
    fourCards(data);
    await draw(data);

    await pick("Aardvark", "Beetle");
    await count("2 selected");

    await userEvent.keyboard("{Escape}");
    await gone(byTestId("pick-bar"));
    await expect.poll(() => pickedCount()).toBe(0);

    await pick("Aardvark");
    await byTestId("pick-clear").click();
    await gone(byTestId("pick-bar"));

    /* Escape puts away one thing. With a task open it is the task, and the
       picks are still there for the next press. */
    await pick("Aardvark", "Beetle", "Cricket");
    await card("Dingo").click();
    await expect.element(byTestId("task-panel")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await gone(byTestId("task-panel"));
    await count("3 selected");

    await userEvent.keyboard("{Escape}");
    await gone(byTestId("pick-bar"));

    /* What is picked belongs to the board on screen, so another view ends it
       rather than carrying a handful of cards across. */
    await pick("Aardvark", "Beetle");
    await page.getByRole("button", { name: /^Phases/ }).click();
    await gone(byTestId("pick-bar"));
    await page.getByRole("button", { name: /^Board/ }).click();
    await gone(byTestId("pick-bar"));
  });

  /* `x` is the whole keyboard route in. The checks are not tab stops, because
     the board has one, and that one is the card the cursor is on. */
  test("x picks the card the cursor is on", async () => {
    const data = newProject();
    fourCards(data);
    await draw(data);

    /* The board's one tab stop is the card the cursor is on, which starts at
       the first card of the first column. */
    const cursor = () => css('[data-testid="card"][tabindex="0"]');
    (cursor().element() as HTMLElement).focus();
    await says(cursor(), "Dingo");

    await userEvent.keyboard("x");
    await count("1 selected");
    await expect.element(card("Dingo")).toHaveAttribute("data-picked", "true");

    /* The arrows move the cursor, so the next `x` picks another card. */
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => cursor().element().textContent).toContain("Aardvark");
    await userEvent.keyboard("x");
    await count("2 selected");

    /* The same key takes one back, so nothing is a one-way press. */
    await userEvent.keyboard("x");
    await count("1 selected");
  });

  /* A filter decides what the view draws, so it decides what the bar counts
     and what a set writes. The card is not unpicked: a filter hides. The
     spec set High on the panel; here the task arrives with it. */
  test("a card a filter hides leaves the picks", async () => {
    const data = newProject();
    withTask(data, "Aardvark", { Status: "Todo", Priority: "High" });
    withTask(data, "Beetle", { Status: "Todo" });
    withTask(data, "Cricket", { Status: "Todo" });
    withTask(data, "Dingo", { Status: "Backlog" });
    await draw(data);

    await pick("Aardvark", "Beetle", "Cricket");
    await count("3 selected");

    await byTestId("filter-button").click();
    await byTestId("filter-search").fill("Priority");
    await userEvent.keyboard("{Enter}");
    await byTestId("filter-box").fill("High");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Escape}");

    await gone(card("Beetle"));
    await count("1 selected");
  });

  /* Shift says "and the ones in between". A plain click still opens the task,
     which is what makes picking a thing you can do without a mode. */
  test("Shift-click picks a run inside one column", async () => {
    const data = newProject();
    fourCards(data);
    await draw(data);

    await check("Aardvark").click();
    await card("Cricket").click(shift);
    await count("3 selected");
    /* Shift opens nothing. */
    await gone(byTestId("task-panel"));
    /* And it selects no words: a Shift-press on a card means "and the ones in
       between", so the browser's own selection never starts. */
    expect(selectedText()).toBe("");

    /* Across columns there is no run: the cards between two columns on screen
       are not the cards between them in any order the board keeps. */
    await card("Dingo").click(shift);
    await count("4 selected");
    expect(pickedCount(column("Backlog").element())).toBe(1);
  });

  /* A plain click opens a task and picks nothing, so the run is measured from
     the open task, as a click and a Shift-click are in every file list. */
  test("Shift-click after a plain click picks the open card and all between", async () => {
    const data = newProject();
    fourCards(data);
    await draw(data);
    const close = page.getByRole("button", { name: "Close task" });

    /* Downward. */
    await card("Aardvark").click();
    await expect.element(byTestId("task-panel")).toBeVisible();
    await gone(byTestId("pick-bar"));
    await card("Cricket").click(shift);
    await count("3 selected");
    await close.click();
    await byTestId("pick-clear").click();

    /* Upward. */
    await card("Cricket").click();
    await card("Aardvark").click(shift);
    await count("3 selected");
    await close.click();
    await byTestId("pick-clear").click();

    /* With nothing open and nothing picked, there is no run: not even from
       the board cursor, which sits on the first card. */
    await card("Beetle").click(shift);
    await count("1 selected");
    await expect.element(card("Beetle")).toHaveAttribute("data-picked", "true");
    await byTestId("pick-clear").click();

    /* The open task is in another column: a run across two columns is two
       runs, so only the clicked card is picked. */
    await card("Dingo").click();
    await card("Cricket").click(shift);
    await count("1 selected");
    expect(pickedCount()).toBe(1);
    await expect.element(card("Cricket")).toHaveAttribute("data-picked", "true");
  });
});

/*
 * Archive takes the cards off the board, so the bar itself becomes the
 * question. No dialog, one call, and the picks end with it: a bar still
 * counting cards nobody can see would be counting nothing.
 */
describe("Archiving what is picked", () => {
  test("asks in the bar, then takes all three off the board", async () => {
    const data = newProject();
    fourCards(data);
    const { sent, server } = await draw(data);

    await pick("Aardvark", "Beetle", "Cricket");
    await byTestId("pick-archive").click();

    /* The bar is the question, and it names the real number. */
    await expect.element(byTestId("pick-confirm")).toHaveTextContent("Archive 3 tasks?");
    await gone(byTestId("pick-set"));

    /* Cancel puts the bar back and the cards stay where they are. */
    await byTestId("pick-archive-no").click();
    await count("3 selected");
    await expect.element(card("Aardvark")).toBeVisible();

    /* And so does Escape, before it reaches the picks. */
    await byTestId("pick-archive").click();
    await userEvent.keyboard("{Escape}");
    await count("3 selected");

    /* One call for three cards, not three. */
    await byTestId("pick-archive").click();
    await byTestId("pick-archive-yes").click();
    await says(byTestId("toast"), "Archived 3 tasks.");
    expect(sent("POST", ARCHIVE)).toHaveLength(1);
    expect(sent().filter((r) => r.method !== "GET" && !ARCHIVE.test(r.path))).toEqual([]);

    /* Gone from the board, and the pick went with them. */
    await gone(byTestId("pick-bar"));
    expect(columnOrder("Todo")).toEqual([]);
    await expect.element(card("Dingo")).toBeVisible();

    /* Really archived, not only drawn: the spec read the archive page. */
    expect(server.archived.map((t) => t.title).sort()).toEqual(["Aardvark", "Beetle", "Cricket"]);
  });

  /*
   * A refusal leaves the picks where they were. The call can be refused for a
   * reason nobody could see coming — a task somebody else deleted a moment
   * ago, a socket that dropped — and having to pick twenty cards again is a
   * worse answer than the toast.
   */
  test("a refused archive keeps the picks", async () => {
    const data = newProject();
    fourCards(data);
    const { sent } = await draw(data, ({ method, path }) =>
      method === "POST" && ARCHIVE.test(path)
        ? { status: 400, body: { error: "One of those tasks is not on this board." } }
        : undefined,
    );

    await pick("Aardvark", "Beetle", "Cricket");
    await byTestId("pick-archive").click();
    await byTestId("pick-archive-yes").click();
    await says(byTestId("toast"), "not on this board");
    expect(sent("POST", ARCHIVE)).toHaveLength(1);
    await count("3 selected");
    await expect.element(card("Aardvark")).toBeVisible();
    expect(columnOrder("Todo")).toEqual(["Aardvark", "Beetle", "Cricket"]);
  });
});

/*
 * A list is the same tasks lying down, so it picks the same way. The check is
 * in the gutter before the key rather than a column of its own: the columns of
 * a list are the rows of the card view and nothing else.
 */
describe("Picking on a list", () => {
  test("Shift-click after a plain click picks the open row and all between", async () => {
    const data = newProject();
    fourCards(data);
    withList(data, "Everything");
    await draw(data);

    await listRow("Aardvark").click();
    await expect.element(byTestId("task-panel")).toBeVisible();
    await gone(byTestId("pick-bar"));
    await listRow("Cricket").click(shift);
    await count("3 selected");
    await page.getByRole("button", { name: "Close task" }).click();
    await byTestId("pick-clear").click();

    await listRow("Dingo").click();
    await listRow("Beetle").click(shift);
    await count("3 selected");
    await expect.element(listRow("Aardvark")).not.toHaveAttribute("data-picked", "true");
  });

  test("x and Shift-click pick, and Set writes all of them", async () => {
    const data = newProject();
    fourCards(data);
    withList(data, "Everything");
    const { sent, server } = await draw(data);
    expect(
      byTestId("list-row")
        .getByTestId("list-row-title")
        .elements()
        .map((el) => el.textContent?.trim()),
    ).toEqual(["Aardvark", "Beetle", "Cricket", "Dingo"]);

    /* The list's one tab stop is the row the cursor is on, and `x` picks it. */
    const cursor = css('[data-testid="list-row"][tabindex="0"]');
    (cursor.element() as HTMLElement).focus();
    await says(cursor, "Aardvark");
    await userEvent.keyboard("x");
    await count("1 selected");
    await expect.element(listRow("Aardvark")).toHaveAttribute("data-picked", "true");

    /* The same key takes it back. */
    await userEvent.keyboard("x");
    await gone(byTestId("pick-bar"));

    /* The check is in the gutter, not a column: the headings are the same
       whether anything is picked or not. */
    const headings = () => byTestId("list-head").element().children.length;
    const before = headings();
    await listRow("Aardvark").getByTestId("list-pick").click();
    await count("1 selected");
    expect(headings()).toBe(before);

    /* A real range, down the whole list: a list is one column of rows, so the
       rows between two of them on screen are the rows between them. */
    await listRow("Dingo").click(shift);
    await count("4 selected");
    /* Shift opens nothing. */
    await gone(byTestId("task-panel"));
    /* And it selects no words. A table is the place this shows worst: without
       it the rows go blue from the heading down. */
    expect(selectedText()).toBe("");

    /* And the same bar writes the same one call. A property of four options
       is a row of buttons rather than a menu. */
    await setProperty("Priority");
    await byTestId("pick-menu").getByRole("button", { name: "Urgent" }).click();
    await expect.poll(() => sent("POST", BULK).length).toBe(1);
    await userEvent.keyboard("{Escape}");

    for (const title of ["Aardvark", "Beetle", "Cricket", "Dingo"]) {
      await expect.element(listRow(title).getByText("Urgent")).toBeVisible();
    }
    /* The spec read it again after a reload: it is written, not only drawn. */
    const priority = propertyOf(data, "Priority").id;
    const urgent = optionOf(data, "Priority", "Urgent");
    expect(server.tasks.every((t) => t.values[priority] === urgent)).toBe(true);
  });
});

/*
 * The bar reaches a phone, and the top bar there was already exactly full. So
 * this measures it rather than trusting a look: while something is picked the
 * search box and the two links off the board give it their room, and take it
 * back the moment nothing is.
 */
describe("Picking on a phone", () => {
  test("the bar fits the top bar, and nothing is pushed off it", async () => {
    await page.viewport(390, 780);
    const data = newProject();
    fourCards(data);
    const user = { ...ME, name: "Wilhelmina Featherstonehaugh" };
    data.members[0].name = user.name;
    await draw(data, undefined, { user });

    expect(topBarEnds()).toBeLessThanOrEqual(390);

    /* A phone draws one column, so the cards to pick have to be the ones on
       screen. The bar itself is the same bar at any width. */
    await page.getByRole("button", { name: "Show the column Todo" }).click();
    await pick("Aardvark", "Beetle");
    await expect.element(byTestId("pick-bar")).toBeVisible();
    expect(overflow()).toBe(0);
    expect(topBarEnds()).toBeLessThanOrEqual(390);

    /* What gave the room, and what kept its place. */
    await expect.element(byTestId("search-box")).not.toBeVisible();
    await expect.element(page.getByTitle("Project settings")).not.toBeVisible();
    await expect.element(byTestId("board-mark")).toBeVisible();
    await expect.element(byTestId("pick-set")).toBeVisible();

    /* A finger has something to press. */
    for (const target of [byTestId("pick-set"), byTestId("pick-clear")]) {
      const box = target.element().getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(20);
      expect(box.height).toBeGreaterThanOrEqual(20);
    }

    /* The question is longer than the count, so it is measured too: the mark
       lends it the last of the room while it stands. */
    await byTestId("pick-archive").click();
    await expect.element(byTestId("pick-confirm")).toHaveTextContent("Archive 2 tasks?");
    expect(overflow()).toBe(0);
    expect(topBarEnds()).toBeLessThanOrEqual(390);
    await byTestId("pick-archive-no").click();

    /* And it is a loan, not a taking. */
    await byTestId("pick-clear").click();
    await gone(byTestId("pick-bar"));
    await expect.element(byTestId("search-box")).toBeVisible();
    await expect.element(page.getByTitle("Project settings")).toBeVisible();
    expect(topBarEnds()).toBeLessThanOrEqual(390);
  });
});

/*
 * The box that finds a task is off the top bar below 900 px while something is
 * picked, and `/` went on asking for it. So the key did nothing, in silence,
 * and Escape then `/` was the only way in.
 */
describe("/ while cards are picked", () => {
  test("leaves the picks out and puts the cursor in the box", async () => {
    await page.viewport(600, 820);
    const data = newProject();
    fourCards(data);
    await draw(data);

    await pick("Aardvark", "Beetle", "Cricket");
    await count("3 selected");
    /* The box is not on the bar. This is the press that used to do nothing. */
    await expect.element(byTestId("search-box")).not.toBeVisible();

    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("/");

    /* A search hides nothing and ends by opening one task, so it wins. */
    await gone(byTestId("pick-bar"));
    await expect.poll(() => pickedCount()).toBe(0);
    await expect.element(byTestId("search-box")).toHaveFocus();
    /* The key opened the box; it did not land in it. */
    await expect.element(byTestId("search-box")).toHaveValue("");
  });
});

/*
 * The check in a list gutter under a finger. It was a 14 px square in a 28 px
 * gutter on a 32 px row, and a miss opened the task.
 */
describe("Picking on a list under a finger", () => {
  test("gives the check a finger's room, and draws the same check", async () => {
    await page.viewport(390, 780);
    await commands.touch(true);
    expect(matchMedia("(hover: none)").matches).toBe(true);
    const data = newProject();
    withTask(data, "Aardvark", { Status: "Todo" });
    withList(data, "Everything");
    await draw(data);

    const pickCheck = listRow("Aardvark").getByTestId("list-pick");
    await expect.element(pickCheck).toBeInTheDocument();
    /* It stands there without a hover, because a finger has none. */
    expect(getComputedStyle(pickCheck.element()).opacity).toBe("1");
    const at = pickCheck.element().getBoundingClientRect();
    expect(at.width).toBeGreaterThanOrEqual(24);
    expect(at.height).toBeGreaterThanOrEqual(24);

    /* The button grew around the box, so the check reads as it always did. */
    const box = pickCheck.getByTestId("list-pick-box").element().getBoundingClientRect();
    expect(Math.round(box.width)).toBe(14);
    expect(Math.round(box.height)).toBe(14);
  });
});

/*
 * Set on a multi-select adds or takes away one option and keeps the rest.
 * Thirty tasks, as the spec had: the even ones carry infra, the odd ones ux
 * and docs, and every fifth one bug already. What the route writes is
 * `pick-route.test.ts`'s; here the server answers as it does.
 */
describe("Set on a multi-select", () => {
  function thirty(data: BoardData) {
    const had: Record<string, string[]> = {};
    for (let i = 0; i < 30; i++) {
      const title = `Task ${String(i).padStart(2, "0")}`;
      const list = i % 2 ? ["ux", "docs"] : ["infra"];
      if (i % 5 === 0) list.push("bug");
      withTask(data, title, { Status: "Todo", Labels: list });
      had[title] = list.map((name) => optionOf(data, "Labels", name));
    }
    return had;
  }

  async function pickAllAndOpenLabels() {
    await check("Task 00").click();
    await card("Task 29").click(shift);
    await count("30 selected");
    await setProperty("Labels");
  }

  test("adds Bug to thirty tasks and keeps every label they had", async () => {
    const data = newProject();
    const had = thirty(data);
    const { sent, server } = await draw(data);
    const labels = propertyOf(data, "Labels").id;
    const bug = optionOf(data, "Labels", "bug");
    await pickAllAndOpenLabels();

    const menu = byTestId("pick-menu");
    /* It starts on Add and says what a press will do, before it does it. */
    await expect.element(byTestId("pick-add")).toHaveAttribute("aria-pressed", "true");
    await byTestId("pick-option-search").fill("bug");
    await expect
      .element(byTestId("pick-note"))
      .toHaveTextContent("Adds bug to 24 tasks. Their other Labels stay.");
    await says(menu.getByRole("option", { name: /bug/ }), "6 of 30");

    await menu.getByRole("option", { name: /bug/ }).click();
    await expect.poll(() => sent("POST", BULK).length).toBe(1);
    await expect.element(byTestId("pick-note")).toHaveTextContent("All 30 have bug already.");
    expect(sent("POST", BULK)[0].body).toMatchObject({ change: "add", value: bug });

    for (const task of server.tasks) {
      expect(new Set(task.values[labels] as string[])).toEqual(new Set([...had[task.title], bug]));
    }
  });

  test("takes one label off many tasks, and the others stay", async () => {
    const data = newProject();
    const had = thirty(data);
    const { sent, server } = await draw(data);
    const labels = propertyOf(data, "Labels").id;
    const bug = optionOf(data, "Labels", "bug");
    await pickAllAndOpenLabels();

    const menu = byTestId("pick-menu");
    await byTestId("pick-remove").click();
    await byTestId("pick-option-search").fill("bug");
    await expect
      .element(byTestId("pick-note"))
      .toHaveTextContent("Takes bug off 6 tasks. Their other Labels stay.");

    await menu.getByRole("option", { name: /bug/ }).click();
    await expect.poll(() => sent("POST", BULK).length).toBe(1);
    await expect.element(byTestId("pick-note")).toHaveTextContent("None of the 30 has bug.");
    expect(sent("POST", BULK)[0].body).toMatchObject({ change: "remove", value: bug });

    for (const task of server.tasks) {
      expect(task.values[labels]).toEqual(had[task.title].filter((id) => id !== bug));
    }
  });
});

describe("One word for each idea", () => {
  /* `e2e/words.spec.ts`. The send hint per platform was its other three
     tests, and `mod-key`'s unit tests hold it. */
  test("an empty field, the selection and the archive each have one word", async () => {
    const data = newProject();
    const wordy = withTask(data, "Wordy", { Status: "Todo" });
    const server = serving(data);
    await renderWithBoard(<BoardShell initialTask={wordy.key} />, data, server.answer);

    // An empty field says what a column and a filter chip say.
    const panel = byTestId("task-panel");
    await expect
      .element(panel.getByRole("button", { name: "Due No due", exact: true }))
      .toBeVisible();
    await gone(panel.getByText("Empty", { exact: true }));
    await page.getByRole("button", { name: "Close task" }).click();

    // The check selects; the ✕ clears the selection.
    const pickIt = check("Wordy");
    await expect.element(pickIt).toHaveAccessibleName(/^Select /);
    await pickIt.click();
    await expect.element(pickIt).toHaveAccessibleName(/^Deselect /);
    await count("1 selected");
    await expect.element(page.getByRole("button", { name: "Clear selection" })).toBeVisible();

    // The verb archives; the link leads to what is archived.
    await expect.poll(() => byTestId("pick-archive").element().textContent?.trim()).toBe("Archive");
    await expect.element(page.getByRole("link", { name: "Archived", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await gone(byTestId("pick-bar"));
  });
});
