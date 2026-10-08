import { describe, expect, test } from "vitest";
import { page, type Locator } from "vitest/browser";
import { BoardShell } from "@/components/board/BoardApp";
import type { BoardData, CardView } from "@/lib/types";
import {
  detailOf,
  newProject,
  renderWithBoard,
  withTask,
  type Answer,
  type Sent,
} from "@/test/board";
import { CardViewPanel } from "./CardViewPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { ViewsPanel } from "./ViewsPanel";

/*
 * The card view page, and the board that draws what it says. Each test here
 * was a test of `e2e/card-view.spec.ts`, and its name is the name it had
 * there. The page and the board share one store, as they do in the app, so a
 * change reaches the board in the same breath where the spec went there by a
 * new page. What the server keeps of it is the card view route's to answer.
 * The drag in Properties that moves the card, the panel and the list stayed
 * end to end.
 */

const PROJECT_CARD = /^\/api\/projects\/[0-9a-f-]+\/card-view$/;
const VIEW_CARD = /^\/api\/views\/[0-9a-f-]+\/card-view$/;

/* A task opened from the board is the one on it. */
function serving(data: BoardData): Answer {
  return ({ method, path }) => {
    const asked = /^\/api\/tasks\/([0-9a-f-]+)$/.exec(path);
    if (method === "GET" && asked) {
      const task = data.tasks.find((t) => t.id === asked[1]);
      if (task) return { body: { task: detailOf(task) } };
    }
  };
}

/** The settings page above the board, both drawing from the one store. */
async function draw(data: BoardData, settings = <CardViewPanel />) {
  return renderWithBoard(
    <>
      {settings}
      <BoardShell initialTask={null} />
    </>,
    data,
    serving(data),
  );
}

const byTestId = (id: string) => page.getByTestId(id);
/* The page draws a card of its own as a preview, so a card is the board's. */
const card = (title: string) =>
  byTestId("board-canvas").getByTestId("card").filter({ hasText: title });

/** The row of the page that belongs to one property or built-in part. */
const row = (name: string) =>
  byTestId("card-row").filter({
    has: page.getByRole("button", { name: new RegExp(`^${name} on the card`) }),
  });
const opener = (name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name} on the card`) });

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/** Waits until `count` writes of a kind have gone out. */
async function wrote(sent: () => Sent[], count: number) {
  await expect.poll(() => sent().length).toBe(count);
}

const placeOf = (sent: Sent, propertyId: string) =>
  (sent.body as { cardView: CardView }).cardView.rows[propertyId]?.place;

describe("Card view", () => {
  test("moving a property to the footer moves it on the board", async () => {
    const data = newProject();
    withTask(data, "Card of mine", { Status: "Todo", Priority: "Urgent" });
    const { sent } = await draw(data);
    const priority = data.properties.find((p) => p.name === "Priority")!;

    await expect.element(row("Priority")).toHaveAttribute("data-place", "headerL");
    await opener("Priority").click();
    await page.getByRole("button", { name: "Put Priority in the footer left" }).click();
    await expect.element(row("Priority")).toHaveAttribute("data-place", "footerL");
    await wrote(() => sent("PATCH", PROJECT_CARD), 1);
    expect(placeOf(sent("PATCH", PROJECT_CARD)[0], priority.id)).toBe("footerL");

    // The board draws the same card view, so the change is already there.
    const chips = card("Card of mine").getByTestId("card-chip");
    await expect.element(chips.last()).toHaveAttribute("title", "Priority · Urgent");
  });

  test("the edge stripe belongs to one property at a time", async () => {
    const data = newProject();
    withTask(data, "Striped", { Status: "Todo", Priority: "Urgent" });
    const { sent } = await draw(data);

    await opener("Priority").click();
    await page.getByRole("button", { name: "Put Priority in the edge stripe" }).click();
    await expect.element(row("Priority")).toHaveAttribute("data-place", "edge");
    await expect.element(card("Striped").getByTestId("card-edge")).toBeVisible();

    // Taking the edge takes whoever held it off the card, and says so first.
    await opener("Phase").click();
    await expect
      .element(page.getByText("Taking the edge takes Priority off the card."))
      .toBeVisible();
    await page.getByRole("button", { name: "Put Phase in the edge stripe" }).click();
    await expect.element(row("Phase")).toHaveAttribute("data-place", "edge");
    await expect.element(row("Priority")).toHaveAttribute("data-place", "off");
    await wrote(() => sent("PATCH", PROJECT_CARD), 2);

    // The task carries no phase, so there is nothing to paint the stripe with.
    await gone(card("Striped").getByTestId("card-edge"));
  });

  test("the panel wears the colour of the card it opens", async () => {
    const data = newProject();
    withTask(data, "Coloured", { Status: "Todo", Priority: "Urgent" });
    await draw(data);

    await opener("Priority").click();
    await page.getByRole("button", { name: "Put Priority in the edge stripe" }).click();

    const stripe = card("Coloured").getByTestId("card-edge");
    await expect.element(stripe).toBeVisible();
    const colour = getComputedStyle(stripe.element()).backgroundColor;

    await card("Coloured").click();
    const panel = byTestId("task-panel");
    await expect.element(panel).toBeVisible();
    const band = byTestId("panel-accent");
    await expect.poll(() => getComputedStyle(band.element()).backgroundColor).toBe(colour);

    // The priority used to be said again at the top of the panel. The panel
    // holds it as a property, so it is said once.
    await expect.element(panel.getByText("Urgent").first()).toBeVisible();
  });

  test("a filled row wears its colour behind the words", async () => {
    const data = newProject();
    withTask(data, "Labelled", { Status: "Todo", Priority: "Urgent" });
    const { sent } = await draw(data);

    await opener("Priority").click();
    await page.getByRole("button", { name: "Filled" }).click();
    await wrote(() => sent("PATCH", PROJECT_CARD), 1);

    const chip = card("Labelled").getByTestId("card-chip").filter({ hasText: "Urgent" });
    await expect
      .poll(() => getComputedStyle(chip.element()).backgroundColor)
      .toBe("rgb(224, 87, 77)");
    const style = getComputedStyle(chip.element());
    expect(style.color).not.toBe(style.backgroundColor);
  });

  test("a date has no colours of its own, so the edge is closed to it", async () => {
    await draw(newProject(), <CardViewPanel />);

    await opener("Due").click();
    await expect
      .element(page.getByText("No colours of its own, so the edge stripe is out."))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Put Due in the edge stripe" }))
      .toBeDisabled();
  });

  test("the description joins the card, and Reset takes it back off", async () => {
    const data = newProject();
    const task = withTask(data, "Has a description", { Status: "Todo" });
    task.description = "A longer account of it.";
    const { sent } = await draw(data);

    await opener("Description").click();
    await page.getByRole("button", { name: "Put Description in the body" }).click();
    await expect
      .element(card("Has a description").getByTestId("card-desc"))
      .toHaveTextContent("A longer account of it.");

    // The card view is everybody's, so a reset asks first and says how much moves.
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect
      .element(page.getByText("Reset the card view for everyone? 1 row goes back to the default."))
      .toBeVisible();
    await expect.element(row("Description")).not.toHaveAttribute("data-place", "off");
    await page.getByRole("button", { name: "Yes, reset" }).click();
    await expect.element(row("Description")).toHaveAttribute("data-place", "off");
    await wrote(() => sent("PATCH", PROJECT_CARD), 2);
    expect(sent("PATCH", PROJECT_CARD)[1].body).toEqual({ cardView: null });
    await gone(card("Has a description").getByTestId("card-desc"));
    // Now there is nothing to reset.
    await expect.element(page.getByRole("button", { name: "Reset to default" })).toBeDisabled();
  });

  test("the title cannot be moved and cannot come off", async () => {
    await draw(newProject());

    await expect.element(row("Title")).toHaveAttribute("data-place", "title");
    await expect.element(opener("Title")).toBeDisabled();
  });

  test("a row taken off the card comes back from the same page", async () => {
    const data = newProject();
    const { screen, sent } = await renderWithBoard(<CardViewPanel />, data);
    const due = data.properties.find((p) => p.name === "Due")!;

    await opener("Due").click();
    await page.getByRole("button", { name: "Take off the card" }).click();
    await expect.element(row("Due")).toHaveAttribute("data-place", "off");

    await opener("Due").click();
    await page.getByRole("button", { name: "Put Due in the footer left" }).click();
    await expect.element(row("Due")).toHaveAttribute("data-place", "footerL");
    await wrote(() => sent("PATCH", PROJECT_CARD), 2);
    expect(placeOf(sent("PATCH", PROJECT_CARD)[0], due.id)).toBe("off");
    expect(placeOf(sent("PATCH", PROJECT_CARD)[1], due.id)).toBe("footerL");
    await screen.unmount();

    // The card view is the one place that says what a card shows.
    const properties = await renderWithBoard(<PropertiesPanel />, data);
    await expect.element(page.getByLabelText("Name of the Due property")).toBeVisible();
    expect(
      properties.screen.container.querySelectorAll("button[aria-label*='on the card']").length,
    ).toBe(0);
  });

  /* The refused body with no rows is the card view route's to answer. */
  test("a view's menu arranges a card view for that view only", async () => {
    const data = newProject();
    withTask(data, "Seen twice", { Status: "Backlog" });
    const dense = {
      ...data.views[0],
      id: "00000000-0000-4000-8000-777777777777",
      name: "Dense",
      kind: "list" as const,
      position: "z0000000",
      isDefault: false,
    };
    data.views.push(dense);
    window.localStorage.clear();
    const { sent } = await renderWithBoard(
      <>
        <ViewsPanel />
        <CardViewPanel viewId={dense.id} />
        <BoardShell initialTask={null} />
      </>,
      data,
      serving(data),
    );
    const listHead = (name: string) =>
      byTestId("list-head-cell").filter({
        has: byTestId("list-head-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
      });
    await byTestId("view-pill").filter({ hasText: "Dense" }).click();
    await expect.element(byTestId("list-view")).toBeVisible();
    // The board's columns are Status, so the project's card leaves it off.
    await gone(listHead("Status"));

    // Nobody has changed a view yet, so no view has a copy to throw away.
    await gone(page.getByRole("button", { name: /^Use the default card view/ }));
    await expect
      .element(page.getByRole("link", { name: "Card view of Dense" }))
      .toHaveAttribute("href", `/p/${data.project.id}/settings/views/${dense.id}/card`);
    await expect.element(page.getByRole("heading", { name: "Card view of Dense" })).toBeVisible();
    await gone(page.getByRole("button", { name: "Use the default", exact: true }));

    await opener("Status").click();
    await page.getByRole("button", { name: "Put Status in the footer left" }).click();
    await expect.element(row("Status")).toHaveAttribute("data-place", "footerL");
    await expect
      .element(page.getByRole("button", { name: "Use the default", exact: true }))
      .toBeVisible();
    await wrote(() => sent("PATCH", VIEW_CARD), 1);
    expect(sent("PATCH", VIEW_CARD)[0].path).toBe(`/api/views/${dense.id}/card-view`);
    // The project's card view is untouched.
    expect(sent("PATCH", PROJECT_CARD)).toEqual([]);

    // The list draws its copy: the grouping property is a column now.
    await expect.element(listHead("Status")).toBeVisible();
    await expect
      .poll(() => byTestId("list-row").filter({ hasText: "Seen twice" }).element().textContent)
      .toContain("Backlog");

    // Only the view with a copy offers the way back, and it asks first.
    const back = page.getByRole("button", { name: /^Use the default card view/ });
    await expect.element(back).toHaveAccessibleName("Use the default card view for Dense");
    await back.click();
    await page.getByRole("button", { name: /^Yes, / }).click();
    await gone(back);
    await wrote(() => sent("PATCH", VIEW_CARD), 2);
    expect(sent("PATCH", VIEW_CARD)[1].body).toEqual({ cardView: null });
    await gone(listHead("Status"));
  });
});
