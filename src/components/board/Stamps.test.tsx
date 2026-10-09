import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { CardViewPanel } from "@/components/settings/CardViewPanel";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * Created and Updated wait to be turned on. This was a test of
 * `e2e/stamps.spec.ts`, and its name is the name it had there. The page and
 * the board share one store, so the card changes in the same breath where the
 * spec went there by a new page. The server and the browser reading the same
 * day stayed end to end; the order by Updated is `stamps.test.ts`.
 */

const byTestId = (id: string) => page.getByTestId(id);
/* The page draws a card of its own as a preview, so a card is the board's. */
const card = (title: string) =>
  byTestId("board-canvas").getByTestId("card").filter({ hasText: title });
const opener = (name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name} on the card`) });
const row = (name: string) => byTestId("card-row").filter({ has: opener(name) });
const listHead = (name: string) =>
  byTestId("list-head-cell").filter({
    has: byTestId("list-head-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });
const stamped = (title: string, which: string) =>
  card(title).element().querySelectorAll(`[title^="${which}"]`).length;

test("Created and Updated wait to be turned on, then read on the card and in a list", async () => {
  const data = newProject();
  withTask(data, "Stamped", { Status: "Todo" });
  data.views.push({
    ...data.views[0],
    id: "00000000-0000-4000-8000-777777777778",
    name: "Rows",
    kind: "list",
    position: "z0000000",
    isDefault: false,
  });
  await renderWithBoard(
    <>
      <CardViewPanel />
      <BoardShell initialTask={null} />
    </>,
    data,
    serving(data).answer,
  );

  await expect.element(card("Stamped")).toBeVisible();
  expect(
    card("Stamped")
      .getByTestId("card-chip")
      .elements()
      .filter((chip) => /^(Created|Updated)/.test(chip.textContent ?? "")),
  ).toHaveLength(0);
  expect(stamped("Stamped", "Updated")).toBe(0);
  expect(stamped("Stamped", "Created")).toBe(0);

  await opener("Updated").click();
  await page.getByRole("button", { name: "Put Updated in the footer left" }).click();
  await expect.element(row("Updated")).toHaveAttribute("data-place", "footerL");
  await expect.poll(() => stamped("Stamped", "Updated · ")).toBe(1);
  expect(stamped("Stamped", "Created")).toBe(0);

  await byTestId("view-pill").filter({ hasText: "Rows" }).click();
  await expect.element(byTestId("list-view")).toBeVisible();
  expect(listHead("Updated").elements()).toHaveLength(1);
  expect(listHead("Created").elements()).toHaveLength(0);
});
