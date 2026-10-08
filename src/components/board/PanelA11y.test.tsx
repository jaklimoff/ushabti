import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { BoardData } from "@/lib/types";
import { ME, newProject, renderWithBoard, withTask, type Answer } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * The task panel, read by a keyboard and by a screen reader. A keyboard that
 * opens a task lands on it, and lands back on the card when it closes; every
 * field says which property it is. Each test was a test of
 * `e2e/panel-a11y.spec.ts`, and its name is the name it had there. The view
 * strip's own test carries `@smoke` and stays there.
 */

const LIST_ID = "00000000-0000-4000-8000-888888888888";
const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const panel = () => byTestId("task-panel");
const title = () => byTestId("task-title");

async function board(data: BoardData, answer?: Answer, initialTask: string | null = null) {
  const server = serving(data);
  const drawn = await renderWithBoard(
    <BoardShell initialTask={initialTask} />,
    data,
    (sent) => answer?.(sent) ?? server.answer(sent),
  );
  return { ...drawn, ...server };
}

/** The e2e helper `addTask`: the composer of a column, and Enter. */
async function addTask(column: string, words: string) {
  await page
    .getByRole("button", { name: `Add a task to ${column}` })
    .first()
    .click();
  await page.getByPlaceholder("What needs doing?").fill(words);
  await userEvent.keyboard("{Enter}");
  await expect.element(card(words)).toBeVisible();
}

describe("The panel and the view strip work without a mouse", () => {
  test("the focus goes to the title on open and back to the card on close", async () => {
    await board(newProject());
    await addTask("Todo", "First to read");
    await expect.element(title()).toHaveValue("First to read");
    await addTask("Todo", "Second to read");

    // A new task opens on its title, so the words can be read at once.
    await expect.element(title()).toHaveValue("Second to read");
    await expect.element(title()).toHaveFocus();

    // One Escape closes a panel nobody has typed in, and the card has the focus.
    await userEvent.keyboard("{Escape}");
    await expect.element(panel()).not.toBeInTheDocument();
    await expect.element(card("Second to read")).toHaveFocus();

    // Enter on the card opens it again, on the title.
    await userEvent.keyboard("{Enter}");
    await expect.element(title()).toHaveFocus();
    await expect.element(title()).toHaveValue("Second to read");

    // The close button gives the focus back the same way.
    await page.getByRole("button", { name: "Close task" }).click();
    await expect.element(panel()).not.toBeInTheDocument();
    await expect.element(card("Second to read")).toHaveFocus();

    // A card opened by a click is the card the focus comes back to.
    await card("First to read").click();
    await expect.element(title()).toHaveValue("First to read");
    await expect.element(title()).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(card("First to read")).toHaveFocus();

    // The board still has one tab stop, and it is that card.
    const stops = document.querySelectorAll('[data-testid="card"][tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0].textContent).toContain("First to read");
  });

  test("each field is named by its label, and the menus say they are open", async () => {
    const data = newProject();
    const task = withTask(data, "Named fields", { Status: "Todo" });
    await board(data, undefined, task.key);

    // A menu is read with its label, not as "No status, button".
    const status = panel().getByRole("button", { name: "Status Todo", exact: true });
    await expect.element(status).toHaveAttribute("aria-expanded", "false");
    await status.click();
    await expect.element(status).toHaveAttribute("aria-expanded", "true");
    await expect.element(panel().getByRole("listbox", { name: "Status" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(panel().getByRole("listbox", { name: "Status" })).not.toBeInTheDocument();
    await expect.element(status).toHaveFocus();

    // A row of options is a group named by its label, and the chosen one is pressed.
    const priority = panel().getByRole("group", { name: "Priority", exact: true });
    await priority.getByRole("button", { name: "High" }).click();
    await expect
      .element(priority.getByRole("button", { name: "High" }))
      .toHaveAttribute("aria-pressed", "true");

    // The person menu has a box that keeps the focus while the arrows walk
    // the rows. It opens on the reader when the field is empty.
    const assignee = panel().getByRole("button", { name: "Assignee Unassigned", exact: true });
    await assignee.click();
    const people = panel().getByRole("listbox", { name: "Assignee" });
    const find = panel().getByRole("combobox", { name: "Find a person" });
    const at = () => people.element().querySelector('[role="option"][data-at="true"]');
    await expect.element(find).toHaveFocus();
    const rows = people.getByRole("option");
    await expect.element(rows.nth(0)).toHaveAccessibleName("Unassigned");
    await expect.element(rows.nth(0)).toHaveAttribute("aria-selected", "true");
    // The reader is the first person, and the highlight sits on them.
    await expect.element(rows.nth(1)).toHaveAccessibleName(ME.name);
    await expect.poll(() => at()?.textContent).toContain(ME.name);
    await expect.element(find).toHaveAttribute("aria-activedescendant", at()!.id);
    await userEvent.keyboard("{ArrowUp}");
    await expect.poll(() => at()?.textContent).toContain("Unassigned");
    await expect.element(find).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(people).not.toBeInTheDocument();
    await expect.element(assignee).toHaveFocus();
    // Typing narrows the rows and hides the empty one; Enter picks.
    await assignee.click();
    await userEvent.keyboard("tes");
    await expect
      .element(people.getByRole("option", { name: "Unassigned" }))
      .not.toBeInTheDocument();
    await expect.poll(() => at()?.textContent).toContain(ME.name);
    await userEvent.keyboard("zzz");
    await expect.poll(() => people.getByRole("option").elements().length).toBe(0);
    await find.fill("ada");
    await userEvent.keyboard("{Enter}");
    const assigned = panel().getByRole("button", { name: `Assignee ${ME.name}`, exact: true });
    await expect.element(assigned).toHaveFocus();
    await assigned.click();
    await expect.poll(() => at()?.textContent).toContain(ME.name);
    await userEvent.keyboard("{Escape}");
    await expect.element(assigned).toHaveFocus();
    // The menu took that Escape, so the panel is still open.
    await expect.element(panel()).toBeVisible();
  });

  test("a list gives the focus back to the row that was open", async () => {
    const data = newProject();
    withTask(data, "Row one", { Status: "Todo" });
    withTask(data, "Row two", { Status: "Todo" });
    data.views.push({
      ...data.views[0],
      id: LIST_ID,
      name: "Rows",
      kind: "list",
      position: "z0000000",
      isDefault: false,
    });
    await board(data);
    await byTestId("view-pill").filter({ hasText: "Rows" }).click();

    const first = byTestId("list-row").filter({ hasText: "Row one" });
    (first.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(title()).toHaveFocus();
    await expect.element(title()).toHaveValue("Row one");
    await userEvent.keyboard("{Escape}");
    await expect.element(panel()).not.toBeInTheDocument();
    await expect.element(first).toHaveFocus();
    const stops = document.querySelectorAll('[data-testid="list-row"][tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0].textContent).toContain("Row one");
  });

  test("the panel's tabs are tabs, and the arrows move between them", async () => {
    const data = newProject();
    const task = withTask(data, "Tabbed task", { Status: "Todo" });
    await board(data, undefined, task.key);

    await expect.element(panel().getByRole("tablist")).toBeVisible();
    const comments = panel().getByRole("tab", { name: /^Comments/ });
    const activity = panel().getByRole("tab", { name: /^Activity/ });
    await expect.element(comments).toHaveAttribute("aria-selected", "true");
    await expect.element(activity).toHaveAttribute("aria-selected", "false");
    await expect.element(panel().getByRole("tabpanel", { name: /^Comments/ })).toBeVisible();

    (comments.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(activity).toHaveFocus();
    await expect.element(activity).toHaveAttribute("aria-selected", "true");
    await expect.element(panel().getByRole("tabpanel", { name: /^Activity/ })).toBeVisible();
  });

  test("an error toast is an alert", async () => {
    const data = newProject();
    const task = withTask(data, "Will not save", { Status: "Todo" });
    await board(
      data,
      ({ method, path }) =>
        method === "PUT" && /\/api\/tasks\/[^/]+\/values\/[^/]+$/.test(path)
          ? { status: 500, body: { error: "The change did not save." } }
          : undefined,
      task.key,
    );

    await panel()
      .getByRole("group", { name: "Priority" })
      .getByRole("button", { name: "Low" })
      .click();
    await expect.element(page.getByRole("alert").filter({ hasText: "did not save" })).toBeVisible();
  });
});
