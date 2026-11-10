import { useEffect } from "react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { BoardShell } from "./BoardApp";
import { useBoard, useBoardActions, type BoardActions } from "./store";
import { TaskCard } from "./TaskCard";

/*
 * The store hands out its actions, its state and its toasts apart, so a toast
 * is no reason for a card to draw again, and an action is the same function
 * for the life of the board. A card is counted inside its own render, so a
 * card that draws again for a context it reads is counted as well as one its
 * column draws again.
 */

type Render = (props: unknown, ref: unknown) => React.ReactNode;
/* `memo` around `forwardRef`: the function is the inner one's. */
const card = (TaskCard as unknown as { type: { render: Render } }).type;
const original = card.render;
let cardRenders = 0;

beforeAll(() => {
  card.render = (props, ref) => {
    cardRenders += 1;
    return original(props, ref);
  };
});
afterAll(() => {
  card.render = original;
});

/** Every actions object and every `useBoard()` action, as each commit had them. */
const seen: { actions: BoardActions[]; setValue: unknown[]; renders: number } = {
  actions: [],
  setValue: [],
  renders: 0,
};
const notify: BoardActions["notify"] = (...args) => seen.actions.at(-1)?.notify(...args);

function Probe() {
  const actions = useBoardActions();
  const { setValue, data } = useBoard();
  useEffect(() => {
    seen.actions.push(actions);
    seen.setValue.push(setValue);
    seen.renders += 1;
  });
  return <span data-testid="probe">{data.tasks.length}</span>;
}

function board() {
  const data = newProject();
  withTask(data, "First card", { Status: "To do" });
  withTask(data, "Second card", { Status: "Doing" });
  return data;
}

describe("the board store", () => {
  test("showing and hiding a toast re-renders no card", async () => {
    const data = board();
    await renderWithBoard(
      <>
        <BoardShell initialTask={null} />
        <Probe />
      </>,
      data,
    );
    await expect.element(page.getByText("First card")).toBeVisible();
    await expect.element(page.getByText("Second card")).toBeVisible();
    /* Let the stream's first read land before counting. */
    await new Promise((done) => setTimeout(done, 300));
    const before = cardRenders;
    expect(before).toBeGreaterThan(0);

    notify("A toast that says nothing failed", "info", { label: "Got it", run: () => undefined });
    await expect.element(page.getByTestId("toast")).toBeVisible();
    expect(cardRenders).toBe(before);

    await userEvent.click(page.getByRole("button", { name: "Got it" }));
    await expect.element(page.getByTestId("toast")).not.toBeInTheDocument();
    expect(cardRenders).toBe(before);
  });

  test("the actions context value is stable for the life of the board", async () => {
    seen.actions = [];
    seen.setValue = [];
    seen.renders = 0;
    const data = board();
    const { ring } = await renderWithBoard(
      <>
        <BoardShell initialTask={null} />
        <Probe />
      </>,
      data,
    );
    await expect.element(page.getByText("First card")).toBeVisible();

    /* Somebody else adds a task; the board reads again and draws it. */
    withTask(data, "Third card", { Status: "To do" });
    const drawn = seen.renders;
    ring();
    await expect.element(page.getByText("Third card")).toBeVisible();
    await expect.element(page.getByTestId("probe")).toHaveTextContent("3");
    expect(seen.renders).toBeGreaterThan(drawn);

    /* And a toast comes and goes. */
    notify("Something", "info");
    await expect.element(page.getByTestId("toast")).toBeVisible();

    expect(new Set(seen.actions).size).toBe(1);
    expect(new Set(seen.setValue).size).toBe(1);
  });
});
