import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { BoardData } from "@/lib/types";
import { ME, newProject, propertyOf, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * What the board draws for somebody who left. Each test was a test of
 * `e2e/former.spec.ts` and carries its name. What the board read sends is
 * `people-route.test.ts`; the columns, the chip and the rejoin are
 * `former.test.ts`.
 */

const GRACE = {
  id: "00000000-0000-4000-9000-00000000a1ef",
  name: "Grace Hopper",
  color: "#2f9e8f",
  emoji: null,
  kind: "human" as const,
};

/** Grace took a task and left: the board sends her as former, not a member. */
function graceLeft(): { data: BoardData } {
  const data = newProject();
  data.former.push(GRACE);
  withTask(data, "Grace's work", { Status: "Todo", Assignee: GRACE.id });
  return { data };
}

const card = () => page.getByTestId("card").filter({ hasText: "Grace's work" });
const panel = () => page.getByTestId("task-panel");

describe("Somebody who left", () => {
  test("a task of somebody who left keeps their name, marked as gone", async () => {
    const { data } = graceLeft();
    const assignee = propertyOf(data, "Assignee");
    const server = serving(data);
    const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data, server.answer);

    await expect.element(card()).toBeVisible();
    const inCard = (selector: string) => card().element().querySelector<HTMLElement>(selector);
    expect(inCard(`[title="Assignee · Grace Hopper (left)"]`)).not.toBeNull();
    await expect.element(inCard("[data-gone]")!).toBeVisible();

    /* The picker shows her as the value and never offers her. */
    await card().click();
    await expect.element(panel()).toBeVisible();
    const picker = panel().getByRole("button", {
      name: "Assignee Grace Hopper (left)",
      exact: true,
    });
    await picker.click();
    await expect.element(panel().getByRole("option", { name: ME.name, exact: true })).toBeVisible();
    await expect
      .element(panel().getByRole("option", { name: /Grace Hopper/ }))
      .not.toBeInTheDocument();

    /* Picking somebody else hands the task on. */
    await panel().getByRole("option", { name: ME.name, exact: true }).click();
    await expect
      .poll(() => sent("PUT", new RegExp(`/values/${assignee.id}$`)).map((s) => s.body))
      .toEqual([{ value: ME.id }]);
    await expect
      .element(panel().getByRole("button", { name: `Assignee ${ME.name}`, exact: true }))
      .toBeVisible();
  });

  test("a filter picks somebody who left, and Unassigned agrees with the board", async () => {
    const { data } = graceLeft();
    const main = data.views.find((v) => v.isDefault)!;
    main.groupById = propertyOf(data, "Assignee").id;
    const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data);

    /* Her column sits after the members and before Unassigned, and takes no card. */
    await expect
      .poll(() =>
        page
          .getByTestId("column-name")
          .elements()
          .map((e) => e.textContent),
      )
      .toEqual([ME.name, "Grace Hopper (left)"]);
    await expect.element(card()).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Add a task to Grace Hopper (left)" }))
      .not.toBeInTheDocument();

    /* The filter lists her under "Left the project", and the chip names her. */
    await page.getByTestId("filter-button").click();
    const search = page.getByTestId("filter-search");
    await search.fill("Assignee");
    await userEvent.keyboard("{Enter}");
    const menu = page.getByTestId("filter-menu");
    await expect.element(menu.getByText("Left the project")).toBeVisible();
    await menu.getByRole("option", { name: "Grace Hopper (left)" }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByText("Assignee is Grace Hopper (left)")).toBeVisible();
    await expect.element(card()).toBeVisible();
    await expect.poll(() => sent("PUT", /\/lens$/).length).toBeGreaterThan(0);
  });
});
