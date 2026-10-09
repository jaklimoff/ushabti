import { afterEach, describe, expect, test } from "vitest";
import { commands, page, userEvent, type Locator } from "vitest/browser";
import { BoardShell } from "@/components/board/BoardApp";
import { newProject, renderWithBoard, type Sent } from "@/test/board";
import { ViewsPanel } from "./ViewsPanel";

/*
 * The Views page of Settings. Each test here was a test of
 * `e2e/settings.spec.ts`, and its name is the name it had there. The main view
 * the board opens on stayed end to end, because it needs a reload.
 */

const VIEW = /^\/api\/views\/[0-9a-f-]+$/;

const box = (locator: Locator) => locator.element().getBoundingClientRect();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The names of the view rows, top to bottom, as the e2e helper `viewRowOrder` reads them. */
const viewRowOrder = () =>
  (page.getByLabelText(/^Name of the view /).elements() as HTMLInputElement[]).map((b) =>
    b.value.trim().toUpperCase(),
  );

async function wrote(sent: () => Sent[], count: number) {
  await expect.poll(() => sent().length).toBe(count);
}

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
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

describe("Settings", () => {
  test("a view made in the strip is deleted from settings, which makes none", async () => {
    const data = newProject();
    // The view the strip made, as the next read of the board carries it.
    data.views.push({
      ...data.views[1],
      id: "00000000-0000-4000-8000-0000000000b1",
      name: "By assignee",
      position: "a9",
    });
    const { sent } = await renderWithBoard(<ViewsPanel />, data);

    await expect.element(page.getByLabelText("Name of the view By assignee")).toBeVisible();
    // One act has one place: the + in the strip. Settings only arranges views.
    expect(page.getByLabelText("Name of the new view").elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Add view" }).elements()).toHaveLength(0);

    await page.getByRole("button", { name: "Delete the view By assignee" }).click();
    await expect.element(page.getByText(/Delete the view By assignee\?/)).toBeVisible();
    expect(sent("DELETE")).toEqual([]);
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await gone(page.getByLabelText("Name of the view By assignee"));
    await wrote(() => sent("DELETE", VIEW), 1);
    expect(sent("DELETE", VIEW)[0].path).toBe("/api/views/00000000-0000-4000-8000-0000000000b1");
  });

  test("a view is dragged into its place, and stays there", async () => {
    const data = newProject();
    const phases = data.views[1];
    const { sent } = await renderWithBoard(
      <>
        <ViewsPanel />
        <BoardShell initialTask={null} />
      </>,
      data,
    );
    expect(viewRowOrder()).toEqual(["BOARD", "PHASES"]);

    const from = box(page.getByRole("button", { name: "Reorder the view Phases" }));
    const to = box(page.getByLabelText("Name of the view Board"));
    await commands.drag(
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: to.x + to.width / 2, y: to.y + to.height / 2 },
    );
    await wrote(() => sent("PATCH", VIEW), 1);
    expect(viewRowOrder()).toEqual(["PHASES", "BOARD"]);
    // Dropped on the first row, it lands after nothing.
    expect(sent("PATCH", VIEW)[0].path).toBe(`/api/views/${phases.id}`);
    expect(sent("PATCH", VIEW)[0].body).toEqual({ afterId: null });

    // The order is one order, so the strip above the board reads the same.
    await expect
      .poll(() =>
        page
          .getByTestId("view-pill")
          .elements()
          .map((el) => el.textContent?.trim().toUpperCase()),
      )
      .toEqual(["PHASES", "BOARD"]);
  });

  test("the keyboard moves a view as well as the pointer", async () => {
    const data = newProject();
    const [board, phases] = data.views;
    const { sent } = await renderWithBoard(<ViewsPanel />, data);
    const grip = page.getByRole("button", { name: "Reorder the view Board" });
    (grip.element() as HTMLElement).focus();

    // Space lifts the row, the arrows move it, Space puts it down.
    await userEvent.keyboard(" ");
    await expect.element(grip).toHaveAttribute("aria-pressed", "true");
    // dnd-kit measures the rows after the lift, which nothing on the page says.
    await pause(50);
    await userEvent.keyboard("{ArrowDown}");
    await pause(120);
    await userEvent.keyboard(" ");

    await expect.poll(viewRowOrder).toEqual(["PHASES", "BOARD"]);
    await wrote(() => sent("PATCH", VIEW), 1);
    expect(sent("PATCH", VIEW)[0].path).toBe(`/api/views/${board.id}`);
    expect(sent("PATCH", VIEW)[0].body).toEqual({ afterId: phases.id });
  });
});

describe("Settings on a phone", () => {
  afterEach(() => page.viewport(1440, 900));

  test("the views page fits the screen and keeps its names whole", async () => {
    await page.viewport(390, 780);
    await renderWithBoard(<ViewsPanel />, newProject());

    await expect.element(page.getByRole("heading", { name: "Views" })).toBeVisible();
    expect(viewRowOrder()).toEqual(["BOARD", "PHASES"]);

    const doc = document.documentElement;
    expect(Math.max(doc.scrollWidth - doc.clientWidth, 0)).toBe(0);
    // Every box draws the whole of its own text. The count is named because an
    // empty list would otherwise measure nothing and pass.
    const names = page.getByLabelText(/^Name of the view /).elements() as HTMLInputElement[];
    expect(names).toHaveLength(2);
    for (const name of names) {
      const cut = name.scrollWidth - name.clientWidth;
      expect(cut, `"${name.value}" is cut off by ${cut} px`).toBeLessThanOrEqual(0);
    }
    await forAFinger(page.getByRole("button", { name: /^Reorder the view / }), 2);
  });
});
