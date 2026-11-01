import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { newProject, renderWithBoard, withPhases, withTask, type Sent } from "@/test/board";
import { CardPanel } from "./CardViewPanel";

/*
 * The Card page: one picker for whose card, then that card. The editor
 * itself is tested in `CardViewPanel.test.tsx`.
 */

const PROJECT_CARD = /^\/api\/projects\/[0-9a-f-]+\/card-view$/;
const VIEW_CARD = /^\/api\/views\/[0-9a-f-]+\/card-view$/;

/** Board keeps a card of its own; Phases follows the default; Road is a roadmap. */
function project() {
  const data = withPhases(newProject());
  const [board, phases] = data.views;
  board.cardView = data.cardView;
  data.views.push({
    ...phases,
    id: "00000000-0000-4000-8000-0000000000c1",
    name: "Road",
    kind: "roadmap",
    position: "z0",
    cardView: null,
  });
  return data;
}

const before = window.location.href;
function openAt(viewId: string | null) {
  window.history.replaceState(null, "", viewId ? `?of=${viewId}` : "?");
}
afterEach(() => window.history.replaceState(null, "", before));

async function wrote(sent: () => Sent[], count: number) {
  await expect.poll(() => sent().length).toBe(count);
}

const whose = () => page.getByRole("navigation", { name: "Whose card" });

describe("The Card page", () => {
  test("the picker names the default and every view that draws a card", async () => {
    const data = project();
    openAt(null);
    await renderWithBoard(<CardPanel />, data);
    await expect.element(page.getByRole("heading", { name: "Card", level: 1 })).toBeVisible();
    const links = whose().getByRole("link");
    await expect
      .poll(() => links.elements().map((a) => a.textContent))
      .toEqual(["Default", "Boardown", "Phasesdefault"]);
    await expect
      .element(whose().getByRole("link", { name: "Default", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(whose().getByRole("link", { name: /^Phases/ }))
      .toHaveAttribute("href", `/p/${data.project.id}/settings/card?of=${data.views[1].id}`);
  });

  test("the default card names who follows it, and its editor writes the project's card", async () => {
    const data = project();
    withTask(data, "Holds the most", { Status: "Todo", Priority: "Urgent" });
    openAt(null);
    const { sent } = await renderWithBoard(<CardPanel />, data);
    await expect
      .element(page.getByTestId("default-card-followers"))
      .toHaveTextContent(
        "Phases follows it. Board has a card of its own. A roadmap draws no card.",
      );
    const preview = page.getByRole("complementary", { name: "What a card looks like" });
    await expect.element(preview.getByText("Holds the most")).toBeVisible();

    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByRole("button", { name: /^Priority on the card/ }).click();
    await page.getByRole("button", { name: "Put Priority in the footer right" }).click();
    await wrote(() => sent("PATCH", PROJECT_CARD), 1);
    expect(sent("PATCH", VIEW_CARD)).toEqual([]);
    await expect.element(page.getByRole("button", { name: "Reset to default" })).toBeVisible();
  });

  test("a view that follows shows its cards, no editor, and the way back to the default", async () => {
    const data = project();
    const phases = data.views[1];
    openAt(phases.id);
    const { sent } = await renderWithBoard(<CardPanel />, data);
    await expect
      .element(whose().getByRole("link", { name: /^Phases/ }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(
        page
          .getByTestId("view-fork")
          .getByText(
            "Phases follows the default card. Change the default, and Phases changes with it.",
          ),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("complementary", { name: "What a card looks like" }))
      .toBeVisible();
    expect(page.getByRole("group", { name: "Arrange the card as" }).elements()).toHaveLength(0);
    await expect
      .element(page.getByRole("link", { name: "Change the default card" }))
      .toHaveAttribute("href", `/p/${data.project.id}/settings/card`);
    expect(sent("PATCH", VIEW_CARD)).toEqual([]);
  });

  test("a view with its own card opens its editor, and a roadmap is never picked", async () => {
    const data = project();
    openAt(data.views[0].id);
    const { sent } = await renderWithBoard(<CardPanel />, data);
    await expect
      .element(
        page
          .getByTestId("view-fork")
          .getByText("Board has a card of its own. A change to the default does not reach it."),
      )
      .toBeVisible();
    await expect.element(page.getByRole("group", { name: "Arrange the card as" })).toBeVisible();
    // Its way back is above the editor, not a second one in its foot.
    expect(page.getByRole("button", { name: "Reset to default" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: /Use the default/ }).elements()).toHaveLength(1);

    await page.getByRole("button", { name: "Use the default card for Board" }).click();
    await page.getByRole("button", { name: "Yes, use the default" }).click();
    await wrote(() => sent("PATCH", VIEW_CARD), 1);
    expect(sent("PATCH", VIEW_CARD)[0].body).toEqual({ cardView: null });
  });

  test("a roadmap in the address opens the default card", async () => {
    const data = project();
    openAt(data.views[2].id);
    await renderWithBoard(<CardPanel />, data);
    await expect
      .element(whose().getByRole("link", { name: "Default", exact: true }))
      .toHaveAttribute("aria-current", "page");
  });
});
