import { expect, test } from "@playwright/test";
import { addTask, card, columnOrder, createProject, register, settles, unique } from "./helpers";

/*
 * One Set on several cards, through to a reload. The rest of picking — the
 * keys, a Shift-click, the bar on a phone, archiving and the multi-select —
 * is `src/components/board/Pick.test.tsx`; the 500s and who may archive are
 * `pick-route.test.ts`.
 */

type Page = import("@playwright/test").Page;

/** The one call a bulk set makes. Nothing else writes to it. */
const BULK = /\/api\/projects\/[0-9a-f-]+\/tasks\/values$/;

/** Three cards in Todo, and one in Backlog that is picked by nothing. */
async function fourCards(page: Page) {
  for (const title of ["Aardvark", "Beetle", "Cricket"]) {
    await addTask(page, "Todo", title);
    await page.getByRole("button", { name: "Close task" }).click();
  }
  await addTask(page, "Backlog", "Dingo");
  await page.getByRole("button", { name: "Close task" }).click();
}

/** The check in the corner of one card. A press picks it, or puts it back. */
function check(page: Page, title: string) {
  return card(page, title).getByTestId("card-pick");
}

async function pick(page: Page, ...titles: string[]) {
  for (const title of titles) await check(page, title).click();
}

/** Says which property to set, and waits for the board to move. */
async function setOnPicked(page: Page, property: string, option: string) {
  await page.getByTestId("pick-set").click();
  const search = page.getByTestId("pick-search");
  await search.fill(property);
  await search.press("Enter");

  const menu = page.getByTestId("pick-menu");
  await menu
    .getByRole("button", { name: `No ${property.toLowerCase()}` })
    .first()
    .click();
  await settles(page, BULK, () => menu.getByRole("option", { name: option }).first().click());
  await page.keyboard.press("Escape");
}

test.describe("Picking several cards", () => {
  test("sets one property on all of them, in one call", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Picked"));
    await fourCards(page);

    /* The bar is not there at rest: nothing is picked when a board opens. */
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);

    await pick(page, "Aardvark", "Beetle", "Cricket");
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    /* The card wears a border and nothing more. */
    await expect(page.locator('[data-testid="card"][data-picked="true"]')).toHaveCount(3);

    /* One call for three cards, not three. A second call would say the board
       was set one card at a time, which is the thing the route exists to
       stop. */
    const calls: string[] = [];
    await page.route("**/api/projects/**", (route) => {
      const asked = route.request();
      if (asked.method() !== "GET") calls.push(new URL(asked.url()).pathname);
      return route.fallback();
    });

    await setOnPicked(page, "Status", "In Progress");

    expect(await columnOrder(page, "In Progress")).toEqual(["Aardvark", "Beetle", "Cricket"]);
    expect(await columnOrder(page, "Todo")).toEqual([]);
    expect(calls.filter((path) => path.endsWith("/tasks/values"))).toHaveLength(1);

    /* The picks stand after a set: setting a second property on the same
       cards is the next thing anybody does. */
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");

    /* And it is really written, not only drawn. */
    await page.reload();
    expect(await columnOrder(page, "In Progress")).toEqual(["Aardvark", "Beetle", "Cricket"]);
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
  });
});
