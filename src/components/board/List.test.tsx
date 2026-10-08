import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { defaultCardView } from "@/lib/card-view";
import { rankBetween } from "@/lib/rank";
import type { BoardData, TaskDTO, ViewDTO } from "@/lib/types";
import {
  detailOf,
  newProject,
  optionOf,
  propertyOf,
  renderWithBoard,
  withTask,
  type Answer,
  type Sent,
} from "@/test/board";
import { ViewsPanel } from "@/components/settings/ViewsPanel";
import { BoardShell } from "./BoardApp";

/*
 * What a list draws, and what a press, a key or a heading sends. Each test
 * here was a test of `e2e/list.spec.ts`, and its name is the name it had
 * there. The drag the board sees, the order that holds across a reload, and
 * the walks with `@smoke` on them stayed end to end. What the views route
 * keeps when a view changes kind is `views-route.test.ts`.
 */

const LENS = /^\/api\/views\/[0-9a-f-]+\/lens$/;
const VIEW = /^\/api\/views\/[0-9a-f-]+$/;
const VIEWS = /^\/api\/projects\/[0-9a-f-]+\/views$/;
const TASKS = /^\/api\/projects\/[0-9a-f-]+\/tasks$/;
const MOVE = /^\/api\/tasks\/[0-9a-f-]+\/move$/;

const LIST_ID = "00000000-0000-4000-8000-777777777777";

/**
 * The server, as far as a list reads it: a task made is answered and then
 * opens, a task asked for is the one on the board, a view made comes back,
 * and a move answers the rank it wrote.
 */
function serving(data: BoardData): Answer {
  let server: BoardData = structuredClone(data);
  let made = 900;
  return ({ method, path, body }) => {
    if (method === "GET" && path.endsWith("/board")) return { body: server };
    if (method === "POST" && TASKS.test(path)) {
      const sent = body as { title: string; values: Record<string, string> };
      made += 1;
      const last = [...server.tasks].sort((a, b) => (a.position < b.position ? -1 : 1)).at(-1);
      const task: TaskDTO = {
        id: `00000000-0000-4000-8000-000000000${made}`,
        number: made,
        key: `${data.project.key}-${made}`,
        title: sent.title,
        description: "",
        position: rankBetween(last?.position, null),
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
      server = { ...server, tasks: [...server.tasks, task] };
      return { body: { task } };
    }
    const asked = /^\/api\/tasks\/([0-9a-f-]+)$/.exec(path);
    if (method === "GET" && asked) {
      const task = server.tasks.find((t) => t.id === asked[1]);
      if (task) return { body: { task: detailOf(task) } };
    }
    if (method === "POST" && MOVE.test(path)) {
      const id = path.split("/")[3];
      const { beforeId, afterId } = body as { beforeId: string | null; afterId: string | null };
      const others = [...server.tasks]
        .sort((a, b) => (a.position < b.position ? -1 : 1))
        .filter((t) => t.id !== id);
      const at = others.findIndex((t) => t.id === (beforeId ?? afterId));
      const position = beforeId
        ? rankBetween(others[at - 1]?.position, others[at].position)
        : rankBetween(others[at].position, others[at + 1]?.position);
      server = {
        ...server,
        tasks: server.tasks.map((t) => (t.id === id ? { ...t, position } : t)),
      };
      return { body: { position } };
    }
    if (method === "POST" && VIEWS.test(path)) {
      const { name, kind, groupById } = body as Pick<ViewDTO, "name" | "kind" | "groupById">;
      const view: ViewDTO = {
        ...server.views[0],
        id: LIST_ID,
        name,
        kind,
        groupById,
        position: "z0000000",
        isDefault: false,
        filters: { rules: [] },
        lens: { rules: [] },
        sort: null,
        lensSort: null,
        cardView: null,
      };
      server = { ...server, views: [...server.views, view] };
      return { body: { view } };
    }
  };
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

/** The board this file works on: three tasks, in a known order. */
function threeTasks(data: BoardData) {
  withTask(data, "First thing", { Status: "Todo" });
  withTask(data, "Second thing", { Status: "Todo" });
  withTask(data, "Third thing", { Status: "Backlog" });
}

function draw(data: BoardData) {
  return renderWithBoard(<BoardShell initialTask={null} />, data, serving(data));
}

const byTestId = (id: string) => page.getByTestId(id);
const listRow = (title: string) => byTestId("list-row").filter({ hasText: title });
const listHead = (name: string) =>
  byTestId("list-head-cell").filter({
    has: byTestId("list-head-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });
const column = (name: string) =>
  byTestId("column").filter({
    has: byTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });
const viewKind = (kind: "Board" | "List") =>
  page
    .getByRole("group", { name: "What the new view shows" })
    .getByRole("button", { name: kind, exact: true });

/** The words of every match, top to bottom. */
const texts = (locator: Locator) => locator.elements().map((el) => el.textContent?.trim() ?? "");

/** The titles of the list, top to bottom, without the row a drag lifts. */
const listOrder = () => texts(byTestId("list-row").getByTestId("list-row-title"));

const html = (locator: Locator) => locator.element() as HTMLElement;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/** Waits until `count` requests of one kind have gone out. */
async function wrote(sent: () => Sent[], count: number) {
  await expect.poll(() => sent().length).toBe(count);
}

/** The element's words hold `text`. `toHaveTextContent` asks for all of them. */
async function says(locator: Locator, text: string) {
  await expect.poll(() => locator.element().textContent ?? "").toContain(text);
}

/** A heading pressed, and the lens it writes. */
async function press(sent: () => Sent[], name: string) {
  const before = sent().length;
  await listHead(name).click();
  await wrote(sent, before + 1);
}

/** The e2e helper `addFilter`: a rule of my own, one value. */
async function addFilter(property: string, value: string) {
  await byTestId("filter-button").click();
  await byTestId("filter-search").fill(property);
  await userEvent.keyboard("{Enter}");
  await byTestId("filter-box").fill(value);
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard("{Escape}");
  await gone(byTestId("filter-menu"));
}

/** How far the page can be pushed sideways. A phone has nowhere to push it. */
function overflow(): number {
  const doc = document.documentElement;
  return Math.max(doc.scrollWidth - doc.clientWidth, 0);
}

afterEach(async () => {
  await page.viewport(1440, 900);
});

describe("A list view", () => {
  test("does not ask what to group by, because it groups nothing", async () => {
    await draw(newProject());

    await page.getByRole("button", { name: "New view" }).click();
    await expect.element(page.getByText("Columns by")).toBeVisible();

    await viewKind("List").click();
    await gone(page.getByText("Columns by"));
    await expect
      .element(page.getByText("One row for each task, in the order the board already has."))
      .toBeVisible();

    // And back again: the question returns with its answer still chosen.
    await viewKind("Board").click();
    await expect.element(page.getByText("Columns by")).toBeVisible();
  });

  /* The spec took Priority off in Settings and opened the list again. Here
     the card view arrives as the next read of the board would bring it. */
  test("carries the same chips a card does, and follows the card view", async () => {
    const data = newProject();
    withTask(data, "Wears a priority", { Status: "Todo", Priority: "Urgent" });
    withList(data, "Rows");
    const first = await draw(data);
    await expect.element(listRow("Wears a priority").getByText("Urgent")).toBeVisible();
    await first.screen.unmount();

    // Take Priority off the card and it leaves the list too: one card view,
    // two drawings.
    const priority = propertyOf(data, "Priority").id;
    data.cardView = {
      ...data.cardView,
      rows: {
        ...data.cardView.rows,
        [priority]: { ...data.cardView.rows[priority], place: "off" },
      },
    };
    await draw(data);
    await expect.element(listRow("Wears a priority")).toBeVisible();
    await gone(listRow("Wears a priority").getByText("Urgent"));
  });

  /* The screen half. That the view keeps its grouping property is the views
     route's, in `views-route.test.ts`. */
  test("keeps its columns when it becomes a board and comes back", async () => {
    const data = newProject();
    const phases = data.views.find((v) => v.name === "Phases")!;
    const { sent } = await renderWithBoard(<ViewsPanel />, data);

    const kind = page.getByLabelText("How the view Phases shows");
    const grouping = page.getByLabelText("Grouping property of the view Phases");
    const choose = async (select: Locator, label: string) => {
      const list = select.element().getAttribute("aria-controls");
      await select.click();
      await page
        .elementLocator(document.getElementById(list!)!)
        .getByRole("option", { name: label, exact: true })
        .click();
    };

    await expect.element(kind).toHaveAttribute("data-value", "board");
    await expect.element(grouping).toHaveAttribute("data-value", phases.groupById!);

    // Becoming a list takes the question away and asks nothing before it does.
    await choose(kind, "List");
    await wrote(() => sent("PATCH", VIEW), 1);
    expect(sent("PATCH", VIEW)[0].body).toEqual({ kind: "list" });
    await gone(grouping);
    await gone(page.getByRole("button", { name: /^Yes, / }));

    // And back: the same property, remembered.
    await choose(kind, "Board");
    await wrote(() => sent("PATCH", VIEW), 2);
    expect(sent("PATCH", VIEW)[1].body).toEqual({ kind: "board" });
    await expect.element(grouping).toHaveAttribute("data-value", phases.groupById!);
  });

  test("has one tab stop, and the arrow keys walk it", async () => {
    const data = newProject();
    threeTasks(data);
    withList(data, "Keys");
    await draw(data);

    // dnd-kit hands every row a stop. The list keeps one.
    await expect.element(listRow("First thing")).toBeVisible();
    expect(document.querySelectorAll('[data-testid="list-row"][tabindex="0"]')).toHaveLength(1);

    await listRow("First thing").click();
    await page.getByRole("button", { name: "Close task" }).click();
    html(listRow("First thing")).focus();

    await userEvent.keyboard("{ArrowDown}");
    await expect.element(listRow("Second thing")).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect.element(listRow("Third thing")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(listRow("Third thing")).toHaveFocus(); // nothing wraps
    await userEvent.keyboard("{Home}");
    await expect.element(listRow("First thing")).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("tab", { name: /^Comments/ })).toBeVisible();
  });

  test("n opens the composer at the end", async () => {
    const data = newProject();
    withTask(data, "One row", { Status: "Todo" });
    withList(data, "Rows");
    const { sent } = await draw(data);

    html(listRow("One row")).focus();
    await userEvent.keyboard("n");
    const input = page.getByPlaceholder("What needs doing?");
    await expect.element(input).toHaveFocus();
    await input.fill("Made with n");
    await userEvent.keyboard("{Enter}");
    await wrote(() => sent("POST", TASKS), 1);
    await expect.element(listRow("Made with n")).toBeVisible();
  });

  test("moves a row with the keyboard alone", async () => {
    const data = newProject();
    threeTasks(data);
    withList(data, "Lift");
    const { sent } = await draw(data);
    const [first, second] = data.tasks;

    html(listRow("First thing")).focus();
    await userEvent.keyboard(" ");
    const overlay = byTestId("list-row-overlay");
    await expect.element(overlay).toBeVisible();
    // dnd-kit measures the rows in an effect that runs after the lift, and
    // the arrow key needs those measurements. So wait as a person waits.
    await pause(150);

    // A list reorders by transform and its DOM order does not change, so the
    // thing to wait for is the lifted row arriving over the row below it.
    const lifted = overlay.element().getBoundingClientRect().y;
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .poll(() => overlay.element().getBoundingClientRect().y)
      .toBeGreaterThan(lifted + 8);

    await userEvent.keyboard(" ");
    await wrote(() => sent("POST", MOVE), 1);
    expect(sent("POST", MOVE)[0].path).toBe(`/api/tasks/${first.id}/move`);
    expect(sent("POST", MOVE)[0].body).toMatchObject({ afterId: second.id });

    await expect.poll(listOrder).toEqual(["Second thing", "First thing", "Third thing"]);
    // Dropping must not also open the task.
    await gone(byTestId("task-panel"));
  });

  test("a task added under a filter is not hidden by it", async () => {
    const data = newProject();
    withTask(data, "Already here", { Status: "Todo", Priority: "Urgent" });
    withList(data, "Urgent only");
    const { sent } = await draw(data);

    await addFilter("Priority", "Urgent");
    await expect.element(byTestId("task-count")).toHaveTextContent("1 task");

    // The composer says what it is about to write, and then writes it, so the
    // new row survives the filter it was born into.
    await byTestId("list-add").click();
    await expect.element(page.getByText("sets Priority Urgent")).toBeVisible();
    await page.getByPlaceholder("What needs doing?").fill("Born urgent");
    await userEvent.keyboard("{Enter}");

    await wrote(() => sent("POST", TASKS), 1);
    const values = (sent("POST", TASKS)[0].body as { values: Record<string, string> }).values;
    expect(values[propertyOf(data, "Priority").id]).toBe(optionOf(data, "Priority", "Urgent"));
    await expect.element(listRow("Born urgent")).toBeVisible();
    // Both pass, so the strip has no "of" to report.
    await expect.element(byTestId("task-count")).toHaveTextContent("2 tasks");
  });

  test("still offers a row to add when a filter hides everything", async () => {
    const data = newProject();
    withTask(data, "The only one", { Status: "Todo" });
    withList(data, "Nothing");
    await draw(data);

    await addFilter("Priority", "Urgent");

    await expect.element(page.getByText("No task passes the filter.")).toBeVisible();
    await gone(byTestId("list-row"));
    // The header and the way out both stay.
    await expect.element(byTestId("list-head")).toBeVisible();
    await expect.element(byTestId("list-add")).toBeVisible();
  });

  /* The project the spec made by deleting in Settings is drawn here as it is
     left. That the server makes a list with nothing to group by is the views
     route's, in `views-route.test.ts`. */
  test("can be made on a project with nothing to group by", async () => {
    const data = newProject();
    const deleted = new Set(["Status", "Assignee", "Phase"]);
    data.properties = data.properties.filter((p) => !deleted.has(p.name));
    data.views = data.views
      .filter((v) => v.name !== "Phases")
      .map((v) => ({ ...v, kind: "list" as const, groupById: null }));
    data.cardView = defaultCardView(data.properties, null);
    const { sent } = await draw(data);
    await expect.element(byTestId("list-view")).toBeVisible();

    // The + used to be a dead end here. A list needs no property to group by.
    await page.getByRole("button", { name: "New view" }).click();
    await page.getByLabelText("Name of the new view").fill("Second list");
    await viewKind("List").click();
    await page.getByRole("button", { name: "Create view" }).click();
    await wrote(() => sent("POST", VIEWS), 1);
    expect(sent("POST", VIEWS)[0].body).toMatchObject({ name: "Second list", kind: "list" });
    await expect.element(byTestId("view-pill").filter({ hasText: "Second list" })).toBeVisible();
    await expect.element(byTestId("list-view")).toBeVisible();
  });

  test("names each way of an order as the board's Sort button does", async () => {
    const data = newProject();
    threeTasks(data);
    withList(data, "Ways");
    const { sent } = await draw(data);
    const lens = () => sent("PUT", LENS);
    const chip = byTestId("sort-chip");

    await press(lens, "Priority");
    await expect
      .element(listHead("Priority"))
      .toHaveAccessibleName("Priority, option order. Again for reverse order.");
    await says(chip, "Priority: Option order");

    await press(lens, "Title");
    await expect.element(listHead("Title")).toHaveAccessibleName("Title, A→Z. Again for Z→A.");
    await says(chip, "Title: A→Z");

    await press(lens, "Title");
    await expect
      .element(listHead("Title"))
      .toHaveAccessibleName("Title, Z→A. Again for the board's own order.");
    await says(chip, "Title: Z→A");
  });

  test("cannot be dragged while it is holding an order", async () => {
    const data = newProject();
    threeTasks(data);
    withList(data, "Frozen");
    const { sent } = await draw(data);
    const lens = () => sent("PUT", LENS);

    await press(lens, "Title");
    const before = listOrder();

    // A drag would write a rank into a list that is not showing ranks, so the
    // rows are held still. Space does not lift one either.
    html(listRow(before[2])).focus();
    await userEvent.keyboard(" ");
    await pause(250);
    await gone(byTestId("list-row-overlay"));
    expect(listOrder()).toEqual(before);

    // And with the order given back, it lifts again.
    await byTestId("sort-clear").click();
    await wrote(lens, 2);
    html(listRow("First thing")).focus();
    await userEvent.keyboard(" ");
    await expect.element(byTestId("list-row-overlay")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(sent("POST", MOVE)).toEqual([]);
  });

  test("the order belongs to the view, not to the board underneath", async () => {
    const data = newProject();
    threeTasks(data);
    withList(data, "Mine");
    const { sent } = await draw(data);

    await press(() => sent("PUT", LENS), "Title");
    await expect.poll(listOrder).toEqual(["First thing", "Second thing", "Third thing"].sort());

    // A sort writes nothing. The rank underneath is untouched, so the board
    // shows exactly what it showed before.
    await byTestId("view-pill").filter({ hasText: "Board" }).first().click();
    await expect
      .poll(() => texts(column("Todo").getByTestId("card-title")))
      .toEqual(["First thing", "Second thing"]);
    expect(sent("POST", MOVE)).toEqual([]);
  });

  test("opens a task beside it, and the panel wears the row's colour", async () => {
    const data = newProject();
    withTask(data, "Open me", { Status: "Todo" });
    withList(data, "Panel");
    await draw(data);

    await listRow("Open me").click();
    await expect.element(byTestId("task-title")).toHaveValue("Open me");
    // The list is still there beside it, not replaced by the panel.
    await expect.element(byTestId("list-view")).toBeVisible();
    await expect.element(listRow("Open me")).toBeVisible();
  });
});

/*
 * A list is one column of rows already, so a phone changes nothing about it:
 * no strip, and a row keeps the columns the card view gives it. What is
 * measured here is that it still fits, and that the way in still works.
 */
describe("A list on a phone", () => {
  test("fits the screen, keeps its columns, and still adds a task", async () => {
    await page.viewport(390, 780);
    const data = newProject();
    withTask(data, "First thing", { Status: "Todo" });
    withList(data, "Rows");
    await draw(data);

    await expect.element(listRow("First thing")).toBeVisible();
    /* The strip of column pills belongs to a board: a list has one column. */
    await gone(byTestId("column-pill"));
    expect(overflow()).toBe(0);

    await byTestId("list-add").click();
    await page.getByPlaceholder("What needs doing?").fill("Second thing");
    await userEvent.keyboard("{Enter}");
    await expect.element(listRow("Second thing")).toBeVisible();
    await page.getByRole("button", { name: "Close task" }).click();
    await expect.poll(listOrder).toEqual(["First thing", "Second thing"]);
    expect(overflow()).toBe(0);
  });
});
