import { expect, test, type Locator } from "@playwright/test";
import { addListView, addTask, card, createProject, listRow, register, unique } from "./helpers";

/*
 * A checkbox can read as its icon on a card: Settings picks the icon and its colour, the
 * card view's Icon mode draws it with no words, and a list cell draws the
 * same. Which chip carries which part is a unit test in
 * `src/lib/__tests__/card-view.test.ts`; this one holds what is drawn.
 */

type Board = {
  properties: { id: string; name: string }[];
  tasks: { id: string; title: string }[];
};

/** The palette's red, #e0574d, as a browser reads it back. */
const RED = "rgb(224, 87, 77)";

function icon(holder: Locator, name: string) {
  return holder.locator(`svg[data-icon="${name}"]`);
}

test("a ticked checkbox in Icon mode shows its icon, and its name on hover", async ({
  page,
}, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Flags"));
  await addTask(page, "Todo", "Is blocked");
  await page.getByRole("button", { name: "Close task" }).click();

  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Blocked", type: "checkbox" },
  });
  expect(made.ok()).toBe(true);
  const board: Board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const blocked = board.properties.find((p) => p.name === "Blocked")!;
  const task = board.tasks.find((t) => t.title === "Is blocked")!;
  expect(
    (
      await page.request.put(`/api/tasks/${task.id}/values/${blocked.id}`, {
        data: { value: true },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.patch(`/api/projects/${projectId}/card-view`, {
        data: { cardView: { rows: { [blocked.id]: { place: "footerL", mode: "icon" } } } },
      })
    ).ok(),
  ).toBe(true);

  // No icon picked yet: Icon mode draws CheckSquare.
  await page.goto(`/p/${projectId}`);
  const chip = card(page, "Is blocked").locator(
    `[data-testid="card-chip"][data-item="${blocked.id}"]`,
  );
  await expect(icon(chip, "CheckSquare")).toBeVisible();
  await expect(chip).toHaveText("");

  // Settings picks Flag, and it saves at once.
  await page.goto(`/p/${projectId}/settings/properties`);
  const look = page.getByRole("button", { name: "Icon of Blocked" });
  await expect(icon(look, "CheckSquare")).toBeVisible();
  await look.click();
  const pop = page.getByRole("dialog", { name: "Colour and icon of Blocked" });
  await expect(pop.getByRole("listbox", { name: "Icon of Blocked" })).toBeVisible();
  await pop.getByRole("searchbox", { name: "Search icons for Blocked" }).fill("flag");
  await page.screenshot({ path: testInfo.outputPath("seen-checkbox-picker.png") });
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/properties/${blocked.id}`),
  );
  await pop.getByRole("option", { name: "Flag", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(pop).toHaveCount(0);
  await expect(icon(look, "Flag")).toBeVisible();

  // The same popover picks a colour, and it saves at once.
  await look.click();
  const coloured = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/properties/${blocked.id}`),
  );
  await pop
    .getByRole("listbox", { name: "Colour of Blocked" })
    .getByRole("option", { name: "Red" })
    .click();
  expect((await coloured).ok()).toBe(true);
  await expect(icon(look, "Flag")).toHaveCSS("color", RED);

  // The card draws the flag and no words, and names it on hover.
  await page.goto(`/p/${projectId}`);
  await expect(icon(chip, "Flag")).toBeVisible();
  await expect(icon(chip, "Flag")).toHaveCSS("color", RED);
  await expect(chip).toHaveText("");
  await chip.hover();
  await expect(page.getByTestId("chip-tip")).toHaveText("Blocked");
  await page.screenshot({ path: testInfo.outputPath("seen-checkbox-card.png") });

  // An unticked box draws nothing.
  await page.request.put(`/api/tasks/${task.id}/values/${blocked.id}`, { data: { value: false } });
  await page.reload();
  await expect(chip).toHaveCount(0);
  await page.request.put(`/api/tasks/${task.id}/values/${blocked.id}`, { data: { value: true } });

  // A list cell draws the same icon.
  await page.reload();
  await addListView(page, "Rows");
  await expect(icon(listRow(page, "Is blocked"), "Flag")).toBeVisible();
  await expect(icon(listRow(page, "Is blocked"), "Flag")).toHaveCSS("color", RED);
  await page.screenshot({ path: testInfo.outputPath("seen-checkbox-list.png") });
});
