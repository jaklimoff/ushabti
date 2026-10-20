import { describe, expect, test } from "vitest";
import { commands, page, userEvent, type Locator } from "vitest/browser";
import { BoardShell } from "@/components/board/BoardApp";
import type { BoardData, CardView } from "@/lib/types";
import {
  ME,
  detailOf,
  newProject,
  renderWithBoard,
  withTask,
  type Answer,
  type Sent,
} from "@/test/board";
import { at } from "@/test/next-navigation";
import { CardViewPanel } from "./CardViewPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { SettingsShell } from "./SettingsShell";
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
async function draw(
  data: BoardData,
  settings = <CardViewPanel />,
  shape: "Card" | "List" = "List",
) {
  const drawn = await renderWithBoard(
    <>
      {settings}
      <BoardShell initialTask={null} />
    </>,
    data,
    serving(data),
  );
  if (shape === "List") await asList();
  return drawn;
}

/** The page opens on the card drawn big; the rows are one press away. */
async function asList() {
  await page.getByRole("button", { name: "List", exact: true }).click();
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
    await asList();
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
  test("an open view row arranges a card view for that view only", async () => {
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
        <BoardShell initialTask={null} />
      </>,
      data,
      serving(data),
    );
    await page.getByRole("button", { name: "Open the view Dense" }).click();
    await asList();
    const listHead = (name: string) =>
      byTestId("list-head-cell").filter({
        has: byTestId("list-head-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
      });
    await byTestId("view-pill").filter({ hasText: "Dense" }).click();
    await expect.element(byTestId("list-view")).toBeVisible();
    // The board's columns are Status, so the project's card leaves it off.
    await gone(listHead("Status"));

    // Nobody has changed a view yet, so no view has a copy to throw away.
    await gone(page.getByRole("button", { name: /^Use the default card/ }));
    await expect
      .poll(() => byTestId("view-fork").element().textContent)
      .toContain("Dense follows the default card");

    await opener("Status").click();
    await page.getByRole("button", { name: "Put Status in the footer left" }).click();
    await expect.element(row("Status")).toHaveAttribute("data-place", "footerL");
    await expect
      .element(page.getByRole("button", { name: "Use the default card for Dense" }))
      .toBeVisible();
    await expect
      .poll(() => byTestId("view-fork").element().textContent)
      .toContain("Dense has a card of its own");
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
    const back = page.getByRole("button", { name: /^Use the default card/ });
    await expect.element(back).toHaveAccessibleName("Use the default card for Dense");
    await back.click();
    await page.getByRole("button", { name: /^Yes, / }).click();
    await gone(back);
    await wrote(() => sent("PATCH", VIEW_CARD), 2);
    expect(sent("PATCH", VIEW_CARD)[1].body).toEqual({ cardView: null });
    await gone(listHead("Status"));
  });
});

/* Was "the card view preview in Settings still draws real tasks" in
   `e2e/settings-load.spec.ts`. Settings is handed the few tasks its loader
   read, which `settings-route.test.ts` holds, and asks the board for none. */
describe("Settings reads its own loader", () => {
  test("the card view preview in Settings still draws real tasks", async () => {
    const data = newProject();
    for (let i = 0; i < 3; i++) withTask(data, `Light ${i}`);
    withTask(data, "Heavy", { Priority: "Urgent" });
    at.pathname = `/p/${data.project.id}/settings/card`;
    const { sent } = await renderWithBoard(
      <SettingsShell initial={data} user={ME} version="0.0.0">
        <CardViewPanel />
      </SettingsShell>,
      data,
    );
    await expect.element(page.getByText("Heavy")).toBeVisible();
    expect(sent("GET", /\/board$/)).toEqual([]);
    at.pathname = null;
  });
});

describe("The card view preview", () => {
  test("hovering a card view row rings its part of the preview card", async () => {
    const data = newProject();
    withTask(data, "Pointed at", { Status: "Todo", Priority: "Urgent" });
    await draw(data);
    const priority = data.properties.find((p) => p.name === "Priority")!;
    const preview = page.getByRole("complementary", { name: "What a card looks like" });
    const chip = preview.element().querySelector(`[data-item="${priority.id}"]`) as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.hasAttribute("data-lit")).toBe(false);

    await row("Priority").hover();
    await expect.poll(() => chip.hasAttribute("data-lit")).toBe(true);
    expect(getComputedStyle(chip).outlineStyle).toBe("solid");
    // Only its own part is ringed.
    expect(preview.element().querySelectorAll("[data-lit]")).toHaveLength(
      preview.element().querySelectorAll(`[data-item="${priority.id}"]`).length,
    );

    // Leaving the row lets the ring go; focusing a row brings one back.
    await page.getByRole("heading", { name: "Card view" }).hover();
    await expect.poll(() => chip.hasAttribute("data-lit")).toBe(false);
    (opener("Priority").element() as HTMLElement).focus();
    await expect.poll(() => chip.hasAttribute("data-lit")).toBe(true);
  });
});

describe("The card drawn big", () => {
  const zone = (place: string) => page.getByTestId(`card-zone-${place}`);
  const drawn = (name: string) =>
    page.getByTestId("card-drawing").getByRole("button", { name: new RegExp(`^${name}, `) });
  const popover = (name: string) => page.getByRole("dialog", { name: `${name} on the card` });

  test("the card editor shows a big card with each chip in its zone and the off rows below", async () => {
    const data = newProject();
    await draw(data, <CardViewPanel />, "Card");

    for (const label of [
      "Header · left",
      "Header · right",
      "Title · always here",
      "Body",
      "Footer · left",
      "Footer · right",
      "Edge",
    ])
      await expect
        .element(page.getByTestId("card-drawing").getByText(label, { exact: true }))
        .toBeVisible();

    // Each row sits in the zone its place names, as its own chip.
    await expect
      .element(zone("headerL").getByRole("button", { name: "Priority, header left" }))
      .toBeVisible();
    await expect.element(drawn("Priority")).toHaveAttribute("title", "Priority");
    await expect.element(zone("headerL").getByRole("button", { name: /^Task ID, / })).toBeVisible();

    // The description waits below, and the body says what it is for.
    const off = page.getByTestId("card-off");
    await expect.element(off.getByText("Not on the card")).toBeVisible();
    await expect
      .element(off.getByRole("button", { name: "Description, not on the card" }))
      .toBeVisible();
    await expect
      .element(zone("body").getByText("Drop a chip here for a line under the title"))
      .toBeVisible();
  });

  test("clicking a chip opens a popover with the modes drawn as sample chips, the edge switch and Take off", async () => {
    const data = newProject();
    withTask(data, "Arranged", { Status: "Todo", Priority: "Urgent" });
    const { sent } = await draw(data, <CardViewPanel />, "Card");
    const priority = data.properties.find((p) => p.name === "Priority")!;

    await drawn("Priority").click();
    const pop = popover("Priority");
    await expect.element(pop).toBeVisible();
    await expect.element(pop.getByText("Header left")).toBeVisible();

    // Every mode is a chip of a real value, and no caption says what it draws.
    const modes = pop.getByRole("group", { name: "How Priority reads" }).getByRole("button");
    expect(modes.elements()).toHaveLength(4);
    for (const mode of modes.elements())
      expect(mode.querySelector('[data-testid="card-chip"]')).not.toBeNull();
    await expect
      .element(pop.getByRole("button", { name: "Colour" }))
      .toHaveAttribute("aria-pressed", "true");
    await gone(pop.getByText("The option's name on a fill of its colour."));

    await pop.getByRole("button", { name: "Filled" }).click();
    await wrote(() => sent("PATCH", PROJECT_CARD), 1);
    expect(
      (sent("PATCH", PROJECT_CARD)[0].body as { cardView: CardView }).cardView.rows[priority.id]
        .mode,
    ).toBe("fill");
    await expect
      .element(pop.getByRole("button", { name: "Filled" }))
      .toHaveAttribute("aria-pressed", "true");

    // The edge is a switch, and the chip moves to the rail.
    await pop.getByRole("switch", { name: "Colour the edge of the card" }).click();
    await wrote(() => sent("PATCH", PROJECT_CARD), 2);
    expect(placeOf(sent("PATCH", PROJECT_CARD)[1], priority.id)).toBe("edge");
    await expect
      .element(zone("edge").getByRole("button", { name: "Priority, edge stripe" }))
      .toBeVisible();
    await expect.element(card("Arranged").getByTestId("card-edge")).toBeVisible();

    await popover("Priority").getByRole("button", { name: "Take off the card" }).click();
    await wrote(() => sent("PATCH", PROJECT_CARD), 3);
    expect(placeOf(sent("PATCH", PROJECT_CARD)[2], priority.id)).toBe("off");
    await expect
      .element(
        page.getByTestId("card-off").getByRole("button", { name: "Priority, not on the card" }),
      )
      .toBeVisible();
    await gone(card("Arranged").getByTestId("card-edge"));
  });

  test("a date has no colours of its own, so its popover has no edge switch", async () => {
    await draw(newProject(), <CardViewPanel />, "Card");
    await drawn("Due").click();
    await expect.element(popover("Due")).toBeVisible();
    await gone(popover("Due").getByRole("switch"));
  });

  test("an off chip can be put in any of the five places from its popover", async () => {
    const data = newProject();
    const { sent } = await draw(data, <CardViewPanel />, "Card");
    const places = [
      ["headerL", "header left"],
      ["headerR", "header right"],
      ["body", "body"],
      ["footerL", "footer left"],
      ["footerR", "footer right"],
    ] as const;

    let writes = 0;
    for (const [place, said] of places) {
      await drawn("Description").click();
      const pop = popover("Description");
      await expect.element(pop.getByText("Put it in")).toBeVisible();
      await gone(pop.getByRole("button", { name: "Take off the card" }));
      expect(pop.getByRole("button", { name: /^Put Description in the / }).elements()).toHaveLength(
        5,
      );

      await pop.getByRole("button", { name: `Put Description in the ${said}` }).click();
      await wrote(() => sent("PATCH", PROJECT_CARD), ++writes);
      expect(placeOf(sent("PATCH", PROJECT_CARD)[writes - 1], "_desc")).toBe(place);
      await expect
        .element(zone(place).getByRole("button", { name: /^Description, / }))
        .toBeVisible();

      await drawn("Description").click();
      await popover("Description").getByRole("button", { name: "Take off the card" }).click();
      await wrote(() => sent("PATCH", PROJECT_CARD), ++writes);
    }
  });

  const middle = (locator: Locator) => {
    const r = locator.element().getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  /* The zones say they are open once dnd-kit has lifted the chip, and the
     short pause is the frame in which it measures them. */
  async function lift(chip: Locator) {
    (chip.element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await expect.element(zone("body")).toHaveAttribute("data-open");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  async function step(arrow: string, to: string) {
    await userEvent.keyboard(arrow);
    await expect.element(page.getByTestId(to)).toHaveAttribute("data-over");
  }

  test("a chip dragged to another zone saves its new place", async () => {
    const data = newProject();
    withTask(data, "Dragged", { Status: "Todo", Priority: "Urgent" });
    const { sent } = await draw(data, <CardViewPanel />, "Card");
    const priority = data.properties.find((p) => p.name === "Priority")!;

    await commands.drag(middle(drawn("Priority")), middle(zone("footerR")));
    await wrote(() => sent("PATCH", PROJECT_CARD), 1);
    expect(placeOf(sent("PATCH", PROJECT_CARD)[0], priority.id)).toBe("footerR");
    await expect
      .element(zone("footerR").getByRole("button", { name: "Priority, footer right" }))
      .toBeVisible();
    // A drag is not a click, so no popover opens.
    await gone(popover("Priority"));

    // From the tray onto the card, and onto the edge.
    await commands.drag(middle(drawn("Description")), middle(zone("body")));
    await wrote(() => sent("PATCH", PROJECT_CARD), 2);
    expect(placeOf(sent("PATCH", PROJECT_CARD)[1], "_desc")).toBe("body");
    await commands.drag(middle(drawn("Priority")), middle(zone("edge")));
    await wrote(() => sent("PATCH", PROJECT_CARD), 3);
    expect(placeOf(sent("PATCH", PROJECT_CARD)[2], priority.id)).toBe("edge");
    await expect.element(card("Dragged").getByTestId("card-edge")).toBeVisible();
  });

  test("a chip dragged to the tray comes off the card", async () => {
    const data = newProject();
    const { sent } = await draw(data, <CardViewPanel />, "Card");
    const priority = data.properties.find((p) => p.name === "Priority")!;

    await commands.drag(middle(drawn("Priority")), middle(page.getByTestId("card-off")));
    await wrote(() => sent("PATCH", PROJECT_CARD), 1);
    expect(placeOf(sent("PATCH", PROJECT_CARD)[0], priority.id)).toBe("off");
    await expect
      .element(
        page.getByTestId("card-off").getByRole("button", { name: "Priority, not on the card" }),
      )
      .toBeVisible();
  });

  test("dropping a chip on the edge takes the old edge holder off", async () => {
    const data = newProject();
    const { sent } = await draw(data, <CardViewPanel />, "Card");
    const priority = data.properties.find((p) => p.name === "Priority")!;
    const status = data.properties.find((p) => p.name === "Status")!;

    await commands.drag(middle(drawn("Priority")), middle(zone("edge")));
    await wrote(() => sent("PATCH", PROJECT_CARD), 1);
    await commands.drag(middle(drawn("Status")), middle(zone("edge")));
    await wrote(() => sent("PATCH", PROJECT_CARD), 2);
    const last = sent("PATCH", PROJECT_CARD)[1];
    expect(placeOf(last, status.id)).toBe("edge");
    expect(placeOf(last, priority.id)).toBe("off");
  });

  test("the edge refuses a chip whose kind cannot colour it", async () => {
    const data = newProject();
    const { sent } = await draw(data, <CardViewPanel />, "Card");

    // While a date is held, the edge shows as closed and the boxes as open.
    await commands.hold(middle(drawn("Due")), middle(zone("edge")));
    await expect.element(zone("edge")).toHaveAttribute("data-closed");
    await expect.element(zone("body")).toHaveAttribute("data-open");
    await expect.element(zone("edge")).not.toHaveAttribute("data-over");
    await commands.letGo();
    await expect.element(zone("edge")).not.toHaveAttribute("data-closed");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent("PATCH", PROJECT_CARD)).toEqual([]);
    await gone(zone("edge").getByRole("button", { name: /^Due, / }));

    // The keyboard steps over it: left from a box goes nowhere.
    await lift(drawn("Due"));
    await expect.element(zone("edge")).toHaveAttribute("data-closed");
    await userEvent.keyboard("{ArrowLeft}");
    await userEvent.keyboard(" ");
    await expect.element(zone("edge")).not.toHaveAttribute("data-closed");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent("PATCH", PROJECT_CARD)).toEqual([]);
  });

  test("the keyboard can move a chip between zones", async () => {
    const data = newProject();
    const { sent } = await draw(data, <CardViewPanel />, "Card");
    const priority = data.properties.find((p) => p.name === "Priority")!;

    // Space lifts, the arrows walk the card, Space drops.
    await lift(drawn("Priority"));
    await step("{ArrowDown}", "card-zone-body");
    await step("{ArrowDown}", "card-zone-footerL");
    await step("{ArrowRight}", "card-zone-footerR");
    await userEvent.keyboard(" ");
    await wrote(() => sent("PATCH", PROJECT_CARD), 1);
    expect(placeOf(sent("PATCH", PROJECT_CARD)[0], priority.id)).toBe("footerR");
    await expect
      .element(zone("footerR").getByRole("button", { name: "Priority, footer right" }))
      .toBeVisible();
    // The drop is not a click: the chip keeps its popover shut.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await gone(popover("Priority"));

    // Down from the foot is the tray; Escape puts the chip back.
    await lift(drawn("Priority"));
    await step("{ArrowDown}", "card-off");
    await userEvent.keyboard("{Escape}");
    await expect.element(zone("body")).not.toHaveAttribute("data-open");
    expect(sent("PATCH", PROJECT_CARD)).toHaveLength(1);

    await lift(drawn("Priority"));
    await step("{ArrowDown}", "card-off");
    await userEvent.keyboard(" ");
    await wrote(() => sent("PATCH", PROJECT_CARD), 2);
    expect(placeOf(sent("PATCH", PROJECT_CARD)[1], priority.id)).toBe("off");
  });

  test("the hint under the editor says a chip drags", async () => {
    await draw(newProject(), <CardViewPanel />, "Card");
    await expect
      .element(
        page
          .getByTestId("card-drawing")
          .getByText("Drag a chip to another place, or off the card."),
      )
      .toBeVisible();
  });

  const PROPERTY = /^\/api\/properties\/[0-9a-f-]+$/;
  /* The chips of one zone, in the order the card draws them. */
  const inZone = (place: string) =>
    Array.from(
      zone(place).element().querySelectorAll<HTMLElement>("[data-testid=card-drawn]"),
      (node) => node.title,
    );

  test("a property chip dragged along its zone moves the property", async () => {
    const data = newProject();
    const { sent } = await draw(data, <CardViewPanel />, "Card");
    const due = data.properties.find((p) => p.name === "Due")!;
    const names = data.properties.map((p) => p.name);
    expect(names.indexOf("Due")).toBeGreaterThan(names.indexOf("Estimate"));
    const before = names[names.indexOf("Estimate") - 1];

    await commands.drag(middle(drawn("Due")), middle(drawn("Estimate")));
    await wrote(() => sent("PATCH", PROPERTY), 1);
    const [move] = sent("PATCH", PROPERTY);
    expect(move.path).toBe(`/api/properties/${due.id}`);
    // Named by what it landed on, as the Properties drag names it.
    expect(move.body).toEqual({
      afterId: data.properties.find((p) => p.name === before)!.id,
    });
    await expect
      .poll(() => inZone("footerL").indexOf("Due"))
      .toBe(inZone("footerL").indexOf("Estimate") - 1);
    // The order is the properties' own: the card view is not written.
    expect(sent("PATCH", PROJECT_CARD)).toEqual([]);
  });

  test("built-in chips cannot be moved along the order", async () => {
    const data = newProject();
    const { sent } = await draw(data, <CardViewPanel />, "Card");
    const footer = inZone("footerL");

    await commands.drag(middle(drawn("Checklist")), middle(drawn("Due")));
    await commands.drag(middle(drawn("Due")), middle(drawn("Comments")));
    await commands.drag(middle(drawn("Task ID")), middle(drawn("Priority")));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent("PATCH", PROPERTY)).toEqual([]);
    expect(sent("PATCH", PROJECT_CARD)).toEqual([]);
    expect(inZone("footerL")).toEqual(footer);
  });

  test("a word chip dropped before a colour chip moves, and the hint says why it is not first", async () => {
    const data = newProject();
    const { sent } = await draw(data, <CardViewPanel />, "Card");
    const estimate = data.properties.find((p) => p.name === "Estimate")!;

    await commands.drag(middle(drawn("Estimate")), middle(zone("headerL")));
    await wrote(() => sent("PATCH", PROJECT_CARD), 1);
    await expect
      .element(zone("headerL").getByRole("button", { name: /^Estimate, / }))
      .toBeVisible();

    await commands.drag(middle(drawn("Estimate")), middle(drawn("Priority")));
    await wrote(() => sent("PATCH", PROPERTY), 1);
    expect(sent("PATCH", PROPERTY)[0].path).toBe(`/api/properties/${estimate.id}`);
    await expect
      .element(page.getByText("Estimate moved in the order. A chip with no words"))
      .toBeVisible();
    expect(inZone("headerL")[0]).toBe("Priority");
  });

  test("somebody who may not change the structure drags nothing along a zone", async () => {
    const data = newProject();
    data.project.mayStructure = false;
    const { sent } = await draw(data, <CardViewPanel />, "Card");
    await expect.element(page.getByText("Drag it along its row")).not.toBeInTheDocument();

    await commands.drag(middle(drawn("Due")), middle(drawn("Estimate")));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent("PATCH", PROPERTY)).toEqual([]);
    expect(sent("PATCH", PROJECT_CARD)).toEqual([]);
  });

  test("the hint says the order is the one order", async () => {
    await draw(newProject(), <CardViewPanel />, "Card");
    await expect
      .element(
        page
          .getByTestId("card-drawing")
          .getByText(
            "Drag it along its row to change the order. That order is the one order, so the task panel follows it.",
          ),
      )
      .toBeVisible();
  });

  test("the List toggle shows the rows, and Card brings the drawing back", async () => {
    await draw(newProject(), <CardViewPanel />, "Card");
    await expect.element(page.getByTestId("card-drawing")).toBeVisible();
    await gone(row("Priority"));

    await asList();
    await gone(page.getByTestId("card-drawing"));
    await expect.element(row("Priority")).toHaveAttribute("data-place", "headerL");

    await page
      .getByRole("group", { name: "Arrange the card as" })
      .getByRole("button", { name: "Card", exact: true })
      .click();
    await expect.element(page.getByTestId("card-drawing")).toBeVisible();
  });
});
