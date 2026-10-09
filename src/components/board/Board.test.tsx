import { afterEach, describe, expect, test } from "vitest";
import { commands, page, userEvent, type Locator } from "vitest/browser";
import type { BoardData, TaskDTO } from "@/lib/types";
import {
  detailOf,
  ME,
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
 * What the board draws, at a desk, on a phone and on a small tablet, and what
 * a press or a key sends. Each test here was a test of `e2e/board.spec.ts`,
 * and its name is the name it had there. The drags of a card between columns
 * stayed there, because the drop target and the key are two decisions, and
 * so did the reloads that have to find what the server kept.
 */

const LENS = /^\/api\/views\/[0-9a-f-]+\/lens$/;
const VIEW = /^\/api\/views\/[0-9a-f-]+$/;
const TASKS = /^\/api\/projects\/[0-9a-f-]+\/tasks$/;
const OPTIONS = /^\/api\/properties\/[0-9a-f-]+\/options$/;
const ARCHIVE = /^\/api\/projects\/[0-9a-f-]+\/archive$/;

const MADE_OPTION = "00000000-0000-4000-8000-888888888888";

/* The e2e suite registered and made a project called `unique("Pocket")`. */
const LONG_PROJECT = "Pocket-mgh8k2xq-a1b2";

/**
 * The server, as far as the board reads it: a task made is answered and then
 * opens, a task asked for is the one on the board, a column made comes back
 * as an option, and an archive takes the tasks off the board it answers.
 */
function serving(data: BoardData): Answer {
  /* The server's own copy: the store was handed `data`, and a change made to
     it in place would be a change nobody wrote. */
  let server: BoardData = structuredClone(data);
  let made = 900;
  return ({ method, path, body }) => {
    if (method === "GET" && path.endsWith("/board")) return { body: server };
    if (method === "POST" && TASKS.test(path)) {
      const sent = body as { title: string; values: Record<string, string> };
      made += 1;
      const task: TaskDTO = {
        id: `00000000-0000-4000-8000-000000000${made}`,
        number: made,
        key: `${data.project.key}-${made}`,
        title: sent.title,
        description: "",
        position: "a0000000",
        createdAt: "2026-10-08T10:00:00.000Z",
        updatedAt: "2026-10-08T10:00:00.000Z",
        archivedAt: null,
        values: sent.values ?? {},
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        blockedBy: [],
        parts: null,
      };
      server = { ...server, tasks: [task, ...server.tasks] };
      return { body: { task } };
    }
    const asked = /^\/api\/tasks\/([0-9a-f-]+)$/.exec(path);
    if (method === "GET" && asked) {
      const task = server.tasks.find((t) => t.id === asked[1]);
      if (task) return { body: { task: detailOf(task) } };
    }
    if (method === "POST" && OPTIONS.test(path)) {
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
    if (method === "POST" && ARCHIVE.test(path)) {
      const { taskIds } = body as { taskIds: string[] };
      server = { ...server, tasks: server.tasks.filter((t) => !taskIds.includes(t.id)) };
      return { body: { archived: taskIds.length } };
    }
  };
}

function draw(data: BoardData, options: Parameters<typeof renderWithBoard>[3] = {}) {
  return renderWithBoard(<BoardShell initialTask={null} />, data, serving(data), options);
}

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const column = (name: string) =>
  byTestId("column").filter({
    has: byTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });
const columnPill = (name: string) => page.getByRole("button", { name: `Show the column ${name}` });

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

const box = (locator: Locator) => locator.element().getBoundingClientRect();
const html = (locator: Locator) => locator.element() as HTMLElement;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The titles of one column's cards, top to bottom. */
const columnOrder = (name: string) =>
  column(name)
    .getByTestId("card-title")
    .elements()
    .map((el) => el.textContent?.trim() ?? "");

/** The words of every match, left to right or top to bottom. */
const texts = (locator: Locator) => locator.elements().map((el) => el.textContent?.trim() ?? "");

/** How far the page can be pushed sideways. A phone has nowhere to push it. */
function overflow(): number {
  const doc = document.documentElement;
  return Math.max(doc.scrollWidth - doc.clientWidth, 0);
}

/** How far the board can be pushed sideways. */
const sideways = () => {
  const el = html(byTestId("board-canvas"));
  return el.scrollWidth - el.clientWidth;
};

/**
 * How far anything on the board's top bar reaches past the bar's own padding.
 * The shell hides its overflow, so a bar that is too long is clipped in
 * silence and `overflow()` cannot see it. The e2e helper `pastTheBar`.
 */
function pastTheBar(): number {
  const bar = document.querySelector('[data-testid="top-bar"]')!;
  const style = getComputedStyle(bar);
  const at = bar.getBoundingClientRect();
  const left = at.left + parseFloat(style.paddingLeft);
  const right = at.right - parseFloat(style.paddingRight);
  let past = 0;
  for (const el of bar.querySelectorAll("*")) {
    const one = el.getBoundingClientRect();
    if (one.width <= 0) continue;
    past = Math.max(past, one.right - right, left - one.left);
  }
  return Math.max(Math.round(past), 0);
}

/** A finger needs 24 px each way, whatever a mouse would settle for. */
async function forAFinger(targets: Locator, count: number) {
  await expect.poll(() => targets.elements().length).toBe(count);
  for (const target of targets.elements()) {
    const label = target.getAttribute("aria-label");
    const at = target.getBoundingClientRect();
    expect(at.width, `${label} is ${at.width} px wide`).toBeGreaterThanOrEqual(24);
    expect(at.height, `${label} is ${at.height} px tall`).toBeGreaterThanOrEqual(24);
  }
}

/**
 * The whole of the name is drawn. A box narrower than its text draws an
 * ellipsis and keeps the text, so only the two widths say so.
 */
function whole(name: Locator) {
  const el = name.element();
  expect(el.scrollWidth, `"${el.textContent}" is cut off`).toBeLessThanOrEqual(el.clientWidth);
}

/** The element's words hold `text`. `toHaveTextContent` asks for all of them. */
async function says(locator: Locator, text: string) {
  await expect.poll(() => locator.element().textContent ?? "").toContain(text);
}

const searchWidth = () => Math.round(box(byTestId("search-box")).width);

/** Waits until `count` requests of one kind have gone out. */
async function wrote(sent: () => Sent[], count: number) {
  await expect.poll(() => sent().length).toBe(count);
}

/** The e2e helper `sortBoard`: the button, the row, and Escape. */
async function sortBoard(sent: () => Sent[], columnName: string) {
  const before = sent().length;
  await byTestId("sort-button").click();
  await byTestId("sort-menu").getByRole("option", { name: columnName }).click();
  await wrote(sent, before + 1);
  await userEvent.keyboard("{Escape}");
  await gone(byTestId("sort-menu"));
}

/**
 * Three cards in Todo and one in Backlog, put on in an order that is not the
 * order any priority puts them in.
 */
function aPricedBoard(data: BoardData) {
  withTask(data, "Aardvark", { Status: "Todo", Priority: "Low" });
  withTask(data, "Beetle", { Status: "Todo", Priority: "Urgent" });
  withTask(data, "Cricket", { Status: "Todo" });
  withTask(data, "Dingo", { Status: "Backlog", Priority: "High" });
}

/** One card in each of the first three columns, and two columns left empty. */
function aColumnEach(data: BoardData) {
  withTask(data, "Aardvark", { Status: "Backlog" });
  withTask(data, "Beetle", { Status: "Todo" });
  withTask(data, "Cricket", { Status: "In Progress" });
}

/* A test that draws at another width puts the desk back for the next one. */
afterEach(async () => {
  await page.viewport(1440, 900);
});

describe("Ushabti board", () => {
  test("a full column scrolls and its cards keep their height", async () => {
    const data = newProject();
    for (let i = 1; i <= 14; i += 1) withTask(data, `Overflow card ${i}`, { Status: "Backlog" });
    await draw(data);

    const body = column("Backlog").getByTestId("column-body");
    await expect.element(body).toBeVisible();
    // The body scrolls. A card clips its own overflow, so a flex column would
    // sooner squash every card to nothing than let this happen.
    expect(body.element().scrollHeight).toBeGreaterThan(body.element().clientHeight);
    expect(box(column("Backlog").getByTestId("card").first()).height).toBeGreaterThan(40);
  });

  test("n opens a composer in the column the cursor is in", async () => {
    const data = newProject();
    withTask(data, "Where the cursor is", { Status: "In Progress" });
    const first = await draw(data);

    // The cursor is on a card in In Progress, so that is where n adds.
    html(card("Where the cursor is")).focus();
    await userEvent.keyboard("n");
    const input = page.getByPlaceholder("What needs doing?");
    await expect.element(input).toHaveFocus();
    await expect.element(column("In Progress").getByPlaceholder("What needs doing?")).toBeVisible();
    await input.fill("Made with n");
    await userEvent.keyboard("{Enter}");
    await wrote(() => first.sent("POST", TASKS), 1);
    const values = (first.sent("POST", TASKS)[0].body as { values: Record<string, string> }).values;
    expect(values[propertyOf(data, "Status").id]).toBe(optionOf(data, "Status", "In Progress"));
    await expect.element(column("In Progress").getByText("Made with n")).toBeVisible();

    // In a field, n is a letter. The panel opened on the new task; its title
    // takes the key, and no composer appears.
    const title = byTestId("task-panel").getByRole("textbox").first();
    await expect.element(title).toBeVisible();
    html(title).focus();
    await userEvent.keyboard("n");
    await gone(page.getByPlaceholder("What needs doing?"));
    await first.screen.unmount();

    // Nothing focused: the cursor rests on the top card of the first column
    // that has one, and n follows it there. The next page reads what was made.
    withTask(data, "Made with n", { Status: "In Progress" });
    await draw(data);
    await expect.element(card("Made with n")).toBeVisible();
    await userEvent.keyboard("n");
    await expect.element(column("In Progress").getByPlaceholder("What needs doing?")).toBeVisible();
  });

  /* The order on screen moves at once; what keeps it is the server's rank,
     which the write names by the pill it landed on. */
  test("a pill is dragged along the strip, and the order keeps", async () => {
    const data = newProject();
    const { sent } = await draw(data);
    const pills = byTestId("view-pill");
    const order = () => texts(pills).map((t) => t.toUpperCase());

    expect(order()).toEqual(["BOARD", "PHASES"]);

    const pill = (name: string) => pills.filter({ hasText: name });
    const from = box(pill("Phases"));
    const to = box(pill("Board"));
    await commands.drag(
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: to.x + to.width / 2, y: to.y + to.height / 2 },
    );
    await wrote(() => sent("PATCH", VIEW), 1);
    expect(order()).toEqual(["PHASES", "BOARD"]);
    // Phases went first, so it landed after nothing.
    expect(sent("PATCH", VIEW)[0].path).toBe(`/api/views/${data.views[1].id}`);
    expect(sent("PATCH", VIEW)[0].body).toEqual({ afterId: null });

    // A drag is not a click: the board still shows the view it was on, which
    // is the one with the Status columns and not the Phase ones.
    await expect.element(column("Backlog")).toBeVisible();
  });

  /* Was "a column folds to a strip, takes a card, and opens again". The drop
     onto the strip is a drag across columns, so it stayed end to end. */
  test("a column folds to a strip, and opens again", async () => {
    const data = newProject();
    withTask(data, "Fold me across", { Status: "Todo" });
    const first = await draw(data);

    const shipped = column("Shipped");
    const open = page.getByRole("button", { name: "Open the column Shipped" });

    await page.getByRole("button", { name: "Fold the column Shipped" }).click();
    await expect.element(open).toBeVisible();
    await expect.element(shipped.getByTestId("column-name")).toHaveTextContent("Shipped");
    await expect.element(shipped.getByTestId("column-count")).toHaveTextContent("0");

    // Giving the width back is the whole point of the fold.
    expect(box(shipped).width).toBeLessThan(80);

    // The fold is this browser's, and the next board it draws keeps it.
    await first.screen.unmount();
    const second = await draw(data, { keepStorage: true });
    await expect.element(open).toBeVisible();

    await open.click();
    await expect
      .element(shipped.getByRole("button", { name: "Add a task to Shipped" }))
      .toBeVisible();

    /* A fold gives width back, and a phone has none to give: it draws one
       column, whole, and the strip above names the rest. So there is no way
       to fold one down there — and the fold this browser wrote is ignored
       rather than cleared, so the wider window gets it back. */
    await page.getByRole("button", { name: "Fold the column Shipped" }).click();
    await expect.element(open).toBeVisible();

    await page.viewport(390, 780);
    await expect.poll(() => byTestId("column").elements().length).toBe(1);
    await gone(column("Todo"));
    await gone(page.getByRole("button", { name: /^Fold the column / }));
    await expect.poll(() => byTestId("column-pill").elements().length).toBe(5);

    await page.viewport(1440, 900);
    await expect.element(open).toBeVisible();
    await gone(byTestId("column-pill"));

    // Nothing about the fold reached the project.
    expect(second.sent().filter((r) => r.method !== "GET")).toEqual([]);
    await second.screen.unmount();
    window.localStorage.clear();
    await draw(data);
    await expect
      .element(column("Shipped").getByRole("button", { name: "Add a task to Shipped" }))
      .toBeVisible();
  });

  /* The reload there read the option back; here the write that makes it is
     counted, and what the server keeps is the options route's to answer. */
  test("add a column, which is a new option on the grouping property", async () => {
    const data = newProject();
    const { sent } = await draw(data);

    await page.getByRole("button", { name: "New column" }).click();
    await page.getByPlaceholder("Column name").fill("Blocked");
    await page.getByRole("button", { name: "Add column" }).click();

    await wrote(() => sent("POST", OPTIONS), 1);
    expect(sent("POST", OPTIONS)[0].path).toBe(
      `/api/properties/${propertyOf(data, "Status").id}/options`,
    );
    expect(sent("POST", OPTIONS)[0].body).toMatchObject({ name: "Blocked" });
    await expect.element(column("Blocked")).toBeVisible();
  });
});

describe("Ordering a board", () => {
  test("names each way of an order by what the column holds", async () => {
    const data = newProject();
    const { sent } = await draw(data);
    const lens = () => sent("PUT", LENS);

    const menu = byTestId("sort-menu");
    const chip = byTestId("sort-chip");
    const press = async (name: string) => {
      const before = lens().length;
      await menu.getByRole("option", { name }).click();
      await wrote(lens, before + 1);
    };

    await byTestId("sort-button").click();

    // A select runs in the order its options were put in, not small to large.
    await press("Priority");
    await says(menu.getByRole("option", { name: "Priority" }), "Option order");
    await says(chip, "Priority: Option order");

    await press("Priority");
    await says(menu.getByRole("option", { name: "Priority" }), "Reverse order");
    await says(chip, "Priority: Reverse order");

    await press("Title");
    await says(menu.getByRole("option", { name: "Title" }), "A→Z");
    await says(chip, "Title: A→Z");

    await press("Due");
    await says(menu.getByRole("option", { name: "Due" }), "Earliest first");
    await says(chip, "Due: Earliest first");
  });

  test("a list is ordered by its headings, so it has no button", async () => {
    const data = newProject();
    withTask(data, "Only one", { Status: "Todo" });
    data.views.push({
      ...data.views[0],
      id: "00000000-0000-4000-8000-777777777777",
      name: "Rows",
      kind: "list",
      position: "z0000000",
      isDefault: false,
    });
    await draw(data);

    await expect.element(byTestId("sort-button")).toBeVisible();
    await byTestId("view-pill").filter({ hasText: "Rows" }).click();
    await expect.element(byTestId("list-view")).toBeVisible();
    await gone(byTestId("sort-button"));
  });
});

/* The button reaches a phone, so its panel has to fit on one. */
describe("Ordering a board on a phone", () => {
  test("the button is in the strip and its panel fits the screen", async () => {
    await page.viewport(390, 780);
    const data = newProject();
    aPricedBoard(data);
    const { sent } = await draw(data);

    await expect.element(byTestId("sort-button")).toBeVisible();
    // Nothing in the view strip is pushed off the side of the screen.
    for (const testid of ["sort-button", "filter-button", "task-count"]) {
      const at = box(byTestId(testid));
      expect(at.x + at.width, testid).toBeLessThanOrEqual(390);
    }

    await sortBoard(() => sent("PUT", LENS), "Priority");
    /* A phone draws one column, and the cards that were ordered are in Todo. */
    await columnPill("Todo").click();
    await expect.element(column("Todo")).toBeVisible();
    expect(columnOrder("Todo")).toEqual(["Beetle", "Aardvark", "Cricket"]);
    await expect.element(byTestId("sort-chip")).toBeVisible();
  });

  /*
   * The top bar is exactly full at this width: the spacer between the name and
   * the search box has nothing left to give. So one more link would push the
   * bar off the side, and the mark — which is all that names the project down
   * here — would be squashed, both of them without a sound.
   */
  test("the top bar fits, and the mark keeps its width", async () => {
    await page.viewport(390, 780);
    const data = newProject();
    data.project.name = LONG_PROJECT;
    await draw(data);

    /* By their titles: an empty board says "Settings" in its hint as well, and
       this is about the two links in the bar. */
    await expect.element(page.getByTitle("The tasks that are archived")).toBeVisible();
    await expect.element(page.getByTitle("Project settings")).toBeVisible();
    expect(overflow()).toBe(0);

    const mark = box(byTestId("board-mark"));
    expect(mark.width).toBe(18);
    expect(mark.height).toBe(18);
  });
});

/*
 * A phone cannot draw two 272 px columns side by side, so from 560 px down it
 * draws one and names the rest in a strip above it. Three ways reach another
 * column — a pill, a swipe and the arrows — and they all write one word, which
 * is why the strip, the canvas and the cursor can never disagree. The swipe
 * needs a touch screen, so it stayed end to end.
 */
describe("A board on a phone", () => {
  test("draws one column, and the strip is the way to the others", async () => {
    await page.viewport(390, 780);
    const data = newProject();
    aColumnEach(data);
    const { sent } = await draw(data);

    // A phone opens on the first column, every time.
    await expect.poll(() => byTestId("column").elements().length).toBe(1);
    await expect.element(column("Backlog")).toBeVisible();
    await expect.element(card("Aardvark")).toBeVisible();
    await gone(card("Beetle"));

    // Full width, and nowhere to push the board sideways.
    expect(box(byTestId("column")).width).toBeGreaterThan(340);
    expect(overflow()).toBe(0);
    expect(sideways()).toBe(0);

    // The strip names every column of the view and says what is in each.
    const pills = byTestId("column-pill");
    await forAFinger(pills, 5);
    expect(texts(pills.getByTestId("column-pill-name")).map((t) => t.toUpperCase())).toEqual([
      "BACKLOG",
      "TODO",
      "IN PROGRESS",
      "READY",
      "SHIPPED",
    ]);
    expect(texts(pills.getByTestId("column-pill-count"))).toEqual(["1", "1", "1", "0", "0"]);

    // A pill is one way to another column.
    await columnPill("Todo").click();
    await expect.element(column("Todo")).toBeVisible();
    expect(byTestId("column").elements()).toHaveLength(1);
    await expect.element(card("Beetle")).toBeVisible();
    await gone(card("Aardvark"));
    expect(sideways()).toBe(0);

    // The arrows are another, through the cursor the board already has: the
    // card the cursor lands on is in the next column, so the board pages and
    // the focus follows it there.
    html(card("Beetle")).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(column("In Progress")).toBeVisible();
    await expect.element(card("Cricket")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(column("Todo")).toBeVisible();
    await expect.element(card("Beetle")).toHaveFocus();

    // And `n` makes a task at the top of the column on screen.
    await userEvent.keyboard("n");
    await page.getByPlaceholder("What needs doing?").fill("Dingo");
    await userEvent.keyboard("{Enter}");
    await wrote(() => sent("POST", TASKS), 1);
    await expect.element(card("Dingo")).toBeVisible();
    await page.getByRole("button", { name: "Close task" }).click();
    await expect.poll(() => column("Todo").getByTestId("card").elements().length).toBe(2);
    expect(texts(pills.getByTestId("column-pill-count"))).toEqual(["1", "2", "1", "0", "0"]);
  });

  test("a card moves by the panel, and the strip says where it went", async () => {
    await page.viewport(390, 780);
    const data = newProject();
    aColumnEach(data);
    const { sent } = await draw(data);

    await columnPill("Todo").click();

    /* Nothing down here drags. A column has no grip and no fold, and a card
       cannot be lifted — which is what leaves a sideways finger to the board. */
    await expect.element(card("Beetle")).toBeVisible();
    await gone(page.getByRole("button", { name: /^Reorder the column / }));
    await gone(page.getByRole("button", { name: /^Fold the column / }));
    html(card("Beetle")).focus();
    await userEvent.keyboard(" ");
    await pause(150);
    await gone(byTestId("card-overlay"));

    /* So the panel's own control is how a card changes column: it writes the
       one value a drop across a board writes. */
    await card("Beetle").click();
    const panel = byTestId("task-panel");
    await panel.getByRole("button", { name: "Status Todo" }).click();
    await panel.getByRole("option", { name: /^Ready/ }).click();
    const status = propertyOf(data, "Status").id;
    const values = () => sent().filter((r) => r.method !== "GET" && r.path.includes("/values/"));
    await wrote(values, 1);
    expect(values()[0].path).toContain(status);
    await page.getByRole("button", { name: "Close task" }).click();

    const counts = () => texts(byTestId("column-pill").getByTestId("column-pill-count"));
    await expect.poll(counts).toEqual(["1", "0", "1", "1", "0"]);
    await gone(card("Beetle"));

    await columnPill("Ready").click();
    await expect.element(card("Beetle")).toBeVisible();
    expect(sideways()).toBe(0);
  });

  test("picks a card and archives it, with no hover to find the check", async () => {
    await page.viewport(390, 780);
    const data = newProject();
    aColumnEach(data);
    const { sent } = await draw(data);

    await columnPill("Todo").click();
    await card("Beetle").getByTestId("card-pick").click();
    await expect.element(byTestId("pick-bar")).toBeVisible();
    await expect.element(byTestId("pick-count")).toHaveTextContent("1 selected");
    expect(overflow()).toBe(0);

    await byTestId("pick-archive").click();
    await expect.element(byTestId("pick-confirm")).toHaveTextContent("Archive 1 task?");
    await byTestId("pick-archive-yes").click();
    await wrote(() => sent("POST", ARCHIVE), 1);
    await gone(card("Beetle"));
    await expect
      .poll(() => texts(byTestId("column-pill").getByTestId("column-pill-count")))
      .toEqual(["1", "0", "1", "0", "0"]);
  });

  test("the strip scrolls to the column you are on, and fades where there is more", async () => {
    await page.viewport(390, 780);
    const data = newProject();
    aColumnEach(data);
    await draw(data);

    /* Five pills are wider than a phone, so the row pans — and the scrollbar
       is hidden, so the fade at the end is the only thing that says so. */
    const pills = byTestId("column-pills");
    await expect.element(pills).toBeVisible();
    const strip = () => html(pills);
    expect(strip().scrollWidth - strip().clientWidth).toBeGreaterThan(0);
    expect(getComputedStyle(strip()).maskImage).toContain("linear-gradient");

    /** One pill is drawn inside the strip that holds it, from end to end. */
    const inside = async (pill: Locator) => {
      await expect
        .poll(() => {
          const one = box(pill);
          const row = box(pills);
          return one.x >= row.x - 1 && one.x + one.width <= row.x + row.width + 1;
        })
        .toBe(true);
    };

    /* The filled pill is the whole point of the strip, so paging to the last
       column has to bring its pill with it. It used to sit two hundred pixels
       past the end of a strip that had not moved. */
    await columnPill("Shipped").click();
    await expect.element(column("Shipped")).toBeVisible();
    await inside(columnPill("Shipped"));

    /* The fade is now at the other end, because that is where the rest is. */
    expect(strip().scrollLeft).toBeGreaterThan(0);
    expect(getComputedStyle(strip()).maskImage).toContain("linear-gradient");

    /* And back the other way: the strip goes to the start with it. */
    await columnPill("Backlog").click();
    await expect.element(column("Backlog")).toBeVisible();
    await inside(columnPill("Backlog"));
    await expect.poll(() => strip().scrollLeft).toBe(0);
  });
});

/*
 * A small tablet, and a window as narrow as one. Both names used to go at
 * 560 px, where the bar still had 118 px of room. They go at 520 px now, and
 * the box that finds a task is what gives its width up first.
 */
describe("The top bar on a small tablet", () => {
  test("keeps the project name and the person's name", async () => {
    await page.viewport(560, 820);
    const data = newProject();
    /* A short name on purpose: this measures the room the bar has, not how
       long a name may be. */
    data.project.name = "Pocket";
    await draw(data);

    const crumb = byTestId("board-crumb");
    const person = byTestId("user-name");
    await expect.element(crumb).toBeVisible();
    await expect.element(person).toBeVisible();
    await expect.element(crumb).toHaveTextContent("Pocket");
    await expect.element(person).toHaveTextContent(ME.name);
    whole(crumb);
    whole(person);
    expect(overflow()).toBe(0);

    /* And gives them up on a phone, where there is no room for them. */
    await page.viewport(390, 820);
    await expect.element(byTestId("board-crumb")).not.toBeVisible();
    await expect.element(byTestId("user-name")).not.toBeVisible();
    expect(overflow()).toBe(0);
  });
});

/*
 * A small tablet with a long name at each end of the bar and three cards
 * picked. The bar ran 80 px off its own side here, and the box that finds a
 * task was squeezed to 31 px of border and padding on the way — neither with
 * a sound, because the shell clips what hangs out of it rather than scrolling.
 */
describe("The top bar with cards picked", () => {
  test("keeps every part inside the bar, and the box keeps its floor", async () => {
    await page.viewport(600, 820);
    const data = newProject();
    data.project.name = LONG_PROJECT;
    for (const title of ["Aardvark", "Beetle", "Cricket"])
      withTask(data, title, { Status: "Todo" });
    await draw(data, { user: { ...ME, name: "Wilhelmina Featherstonehaugh" } });

    /* Nothing is picked yet. The names shorten, and the box is never a sliver:
       a box this narrow is a border and its padding and nothing else. */
    await expect.element(byTestId("search-box")).toBeVisible();
    expect(searchWidth()).toBeGreaterThanOrEqual(88);
    expect(pastTheBar()).toBe(0);

    for (const title of ["Aardvark", "Beetle", "Cricket"]) {
      await card(title).getByTestId("card-pick").click();
    }
    await expect.element(byTestId("pick-bar")).toBeVisible();

    /* What gave the room: the ways off this board. What kept its place: the
       picture and the name of the person, and the mark that names the
       project. */
    await expect.element(byTestId("search-box")).not.toBeVisible();
    await expect.element(page.getByTitle("Project settings")).not.toBeVisible();
    await expect.element(byTestId("board-mark")).toBeVisible();
    await expect.element(byTestId("user-name")).toBeVisible();
    expect(pastTheBar()).toBe(0);

    /* The question is longer than the count, so it is measured as well. */
    await byTestId("pick-archive").click();
    await expect.element(byTestId("pick-confirm")).toHaveTextContent("Archive 3 tasks?");
    expect(pastTheBar()).toBe(0);
    await byTestId("pick-archive-no").click();

    /* And it is a loan, not a taking. */
    await byTestId("pick-clear").click();
    await gone(byTestId("pick-bar"));
    await expect.element(byTestId("search-box")).toBeVisible();
    expect(searchWidth()).toBeGreaterThanOrEqual(88);

    /* The floor holds on both sides of the width the names shorten at. It
       used to end there, so the box lost 23 px on one pixel of window. */
    for (const width of [560, 561]) {
      await page.viewport(width, 820);
      await expect.element(byTestId("search-box")).toBeVisible();
      await expect
        .poll(searchWidth, { message: `the box at ${width} px` })
        .toBeGreaterThanOrEqual(88);
      expect(pastTheBar()).toBe(0);
    }
  });
});

/* Was "a new board says where its columns come from" in `e2e/settings.spec.ts`. */
describe("A new board", () => {
  test("a new board says where its columns come from", async () => {
    const data = newProject();
    const { sent } = await draw(data);
    const hint = page.getByText(/every field on a task is yours to rename/i);
    await expect.element(hint).toBeVisible();

    await page.getByRole("button", { name: "Add a task to Todo" }).first().click();
    const input = page.getByPlaceholder("What needs doing?");
    await input.fill("Now it is a real board");
    await userEvent.keyboard("{Enter}");
    await wrote(() => sent("POST", TASKS), 1);

    // It is guidance for an empty board, not furniture.
    await gone(hint);
    await expect.element(column("Todo")).toBeVisible();
  });
});
