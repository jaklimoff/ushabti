import { useEffect } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { BoardData, TaskDTO } from "@/lib/types";
import { newProject, optionOf, propertyOf, renderWithBoard, withTask } from "@/test/board";
import { BoardShell } from "./BoardApp";
import { useBoardActions, type BoardActions } from "./store";
import { TaskCard } from "./TaskCard";
import { TaskRow } from "./TaskRow";

/*
 * A card and a row are `memo`, so they draw again for their own task and for
 * nothing another task does. Each is counted inside its own render, by the
 * task it draws, so a draw for a context it reads is counted as well as one
 * its column asks for.
 */

type Render = (props: { task: TaskDTO; overlay?: boolean }, ref: unknown) => React.ReactNode;
type Memo = { type: { render: Render } };
const drawn: string[] = [];
const patched = [TaskCard, TaskRow].map((component) => {
  const inner = (component as unknown as Memo).type;
  return { inner, original: inner.render };
});

beforeAll(() => {
  for (const { inner, original } of patched) {
    inner.render = (props, ref) => {
      if (!props.overlay) drawn.push(props.task.id);
      return original(props, ref);
    };
  }
});
afterAll(() => {
  for (const { inner, original } of patched) inner.render = original;
});
beforeEach(() => {
  drawn.length = 0;
});

const held: { actions: BoardActions | null } = { actions: null };
function Probe() {
  const actions = useBoardActions();
  useEffect(() => {
    held.actions = actions;
  });
  return null;
}

const LIST_ID = "00000000-0000-4000-8000-0000000000aa";

/** Two hundred cards in two columns. */
function board(list = false): { data: BoardData; tasks: TaskDTO[] } {
  const data = newProject();
  const tasks = Array.from({ length: 200 }, (_, i) =>
    withTask(data, `Card number ${i + 1}`, { Status: i % 2 ? "Todo" : "Backlog" }),
  );
  if (list) {
    for (const view of data.views) view.isDefault = false;
    data.views.push({
      ...data.views[0],
      id: LIST_ID,
      name: "All of it",
      kind: "list",
      position: "z0000000",
      isDefault: true,
    });
  }
  return { data, tasks };
}

/** Lets the stream's first read and every write's answer land. */
const settle = () => new Promise((done) => setTimeout(done, 300));

async function draw(data: BoardData, testId: "card" | "list-row") {
  const screen = await renderWithBoard(
    <>
      <BoardShell initialTask={null} />
      <Probe />
    </>,
    data,
  );
  await expect
    .element(page.getByTestId(testId).filter({ hasText: "Card number 1" }).first())
    .toBeVisible();
  await settle();
  drawn.length = 0;
  return screen;
}

describe("on a board of two hundred cards", () => {
  test("a value written on one task draws only that card", async () => {
    const { data, tasks } = board();
    await draw(data, "card");
    const priority = propertyOf(data, "Priority");

    await held.actions!.setValue(tasks[7].id, priority.id, optionOf(data, "Priority", "High"));
    await settle();
    expect(new Set(drawn)).toEqual(new Set([tasks[7].id]));
  });

  test("a read that changed nothing draws no card, and one that changed one draws one", async () => {
    const { data, tasks } = board();
    const { ring } = await draw(data, "card");

    ring();
    await settle();
    expect(drawn).toEqual([]);

    tasks[42].title = "Renamed elsewhere";
    ring();
    await expect.element(page.getByText("Renamed elsewhere")).toBeVisible();
    await settle();
    expect(new Set(drawn)).toEqual(new Set([tasks[42].id]));
  });

  test("a pick draws the card it picks, once anything is picked", async () => {
    const { data, tasks } = board();
    await draw(data, "card");
    const check = (title: string) =>
      page.getByTestId("card").filter({ hasText: title }).first().getByTestId("card-pick");

    /* The first pick stands the check up on every card, so every card draws. */
    await userEvent.click(check("Card number 1"), { force: true });
    await settle();
    expect(new Set(drawn).size).toBe(200);

    drawn.length = 0;
    await userEvent.click(check("Card number 3"), { force: true });
    await settle();
    expect(new Set(drawn)).toEqual(new Set([tasks[2].id]));
  });

  test("the board is one tab stop, and the arrow keys still walk it", async () => {
    const { data } = board();
    await draw(data, "card");

    expect(document.querySelectorAll('[data-testid="card"][tabindex="0"]')).toHaveLength(1);
    const card = (title: string) =>
      page
        .getByTestId("card")
        .filter({ hasText: new RegExp(`^.*${title}$`) })
        .first();
    (card("Card number 1").element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(card("Card number 3")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(card("Card number 4")).toHaveFocus();
    expect(document.querySelectorAll('[data-testid="card"][tabindex="0"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="card"][tabindex="0"]')?.textContent).toContain(
      "Card number 4",
    );

    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByTestId("task-panel")).toBeVisible();
  });
});

describe("on a list of two hundred rows", () => {
  test("a value written on one task draws only that row, and an empty read none", async () => {
    const { data, tasks } = board(true);
    const { ring } = await draw(data, "list-row");
    const priority = propertyOf(data, "Priority");

    await held.actions!.setValue(tasks[11].id, priority.id, optionOf(data, "Priority", "Low"));
    await settle();
    expect(new Set(drawn)).toEqual(new Set([tasks[11].id]));

    /* The server holds what was written, so reading it back changes nothing. */
    tasks[11].values[priority.id] = optionOf(data, "Priority", "Low");
    drawn.length = 0;
    ring();
    await settle();
    expect(drawn).toEqual([]);
  });
});
