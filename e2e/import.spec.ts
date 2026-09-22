import { expect, test, type Page } from "@playwright/test";
import {
  card,
  column,
  columnOrder,
  createProject,
  gotoSettings,
  overflow,
  register,
  settles,
  showColumn,
  unique,
} from "./helpers";

/**
 * Bringing a board in from Trello.
 *
 * The file is the same one the unit tests read, so the mapping proved without
 * a server is the mapping a browser walks through. What this spec is for is
 * the half a pure test cannot reach: the page is the flow, the owner can
 * point a list somewhere else before anything is written, and pressing the
 * button twice makes nothing twice.
 */
const FIXTURE = "e2e/fixtures/trello-small.json";

/**
 * Opens the page and waits until it is live.
 *
 * A file picked before React has taken the page over goes nowhere: the box is
 * server-rendered and its change event has nobody listening yet. Nothing on
 * screen says when that moment is, so the wait is the board's own stream,
 * which opens the instant the store mounts. The waiter is set up before the
 * page is asked for, or a fast hydration wins the race and nothing answers.
 */
async function openImport(page: Page, projectId: string) {
  const live = page
    .waitForResponse((res) => res.url().includes("/stream"), { timeout: 20_000 })
    .catch(() => null);
  await gotoSettings(page, projectId, "import");
  await live;
}

/** Puts the file in the box and waits for the preview to come back. */
async function pick(page: Page) {
  await settles(page, /\/import\/preview$/, async () => {
    await page.getByLabel("The Trello export to bring in").setInputFiles(FIXTURE);
  });
  await expect(page.getByText("Launch board")).toBeVisible();
}

/** The mapping row of one list or label. */
function mapping(page: Page, name: string) {
  return page.getByLabel(`Where ${name} goes`);
}

test("a Trello export becomes columns and cards, and only once", async ({ page }) => {
  /* The person is called Ada, because one card on the Trello board is Ada's:
     a member is matched by name and never made, and this is the only place
     that can be seen end to end. */
  await register(page, "Ada Lovelace");
  const projectId = await createProject(page, unique("Import"));

  await openImport(page, projectId);
  await pick(page);

  // The preview says what will happen, in numbers.
  await expect(page.getByText("4 coming")).toBeVisible();
  await expect(page.getByText("1 attachment is left behind.")).toBeVisible();
  await expect(page.getByText("1 archived card stays behind", { exact: false })).toBeVisible();

  // A list whose name matches an option is proposed against it, either case.
  await expect(mapping(page, "in progress")).toHaveValue(/[0-9a-f-]{36}/);
  // One nothing matches is proposed as a new column.
  await expect(mapping(page, "To do")).toHaveValue("");

  /* The owner points that list at an option the board already has. This is
     the one thing the preview exists for. */
  await settles(page, /\/import\/preview$/, async () => {
    await mapping(page, "To do").selectOption({ label: "Todo" });
  });
  await expect(mapping(page, "To do")).toHaveValue(/[0-9a-f-]{36}/);

  await settles(page, /\/import$/, () =>
    page.getByRole("button", { name: "Import 4 tasks" }).click(),
  );
  await expect(page.getByText("4 tasks and 2 options are on the board.")).toBeVisible();

  // The board has the columns and the cards, in the order the file had them.
  await page.goto(`/p/${projectId}`);
  await expect(column(page, "Done")).toBeVisible();
  await showColumn(page, "Todo");
  expect(await columnOrder(page, "Todo")).toEqual(["Write the launch note", "Talk to the team"]);
  await showColumn(page, "In Progress");
  await expect(card(page, "Fix the sign-in loop")).toBeVisible();
  await showColumn(page, "Done");
  await expect(card(page, "Ship the changelog")).toBeVisible();
  // The archived card stayed behind: the switch was off.
  await expect(card(page, "Old idea nobody took")).toHaveCount(0);

  // The same file again makes nothing.
  await openImport(page, projectId);
  await pick(page);
  await expect(page.getByText("4 already here")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nothing new to bring in" })).toBeDisabled();

  await page.goto(`/p/${projectId}`);
  await showColumn(page, "Todo");
  await expect(card(page, "Write the launch note")).toHaveCount(1);
  await expect(page.getByTestId("card")).toHaveCount(4);
});

test("a card brings its labels, its due date, its checklist and its comments", async ({ page }) => {
  await register(page, "Ada Lovelace");
  const projectId = await createProject(page, unique("Import"));

  await openImport(page, projectId);
  await pick(page);
  await settles(page, /\/import$/, () =>
    page.getByRole("button", { name: "Import 4 tasks" }).click(),
  );

  await page.goto(`/p/${projectId}`);
  await showColumn(page, "Done");
  await card(page, "Ship the changelog").click();

  const panel = page.getByTestId("task-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Before: Draft it")).toBeVisible();
  await expect(panel.getByText("After: Post it")).toBeVisible();
  /* The panel writes a date the way the board does, in words. */
  await expect(panel.getByText("Mar 4")).toBeVisible();

  await page.keyboard.press("Escape");
  await showColumn(page, "To do");
  await card(page, "Talk to the team").click();
  await expect(panel.getByText("I will book the room.")).toBeVisible();
  await expect(panel.getByText("Let us do this after the release.")).toBeVisible();
});

test("the import page reads on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await register(page, "Ada Lovelace");
  const projectId = await createProject(page, unique("Import"));

  await openImport(page, projectId);
  await pick(page);

  expect(await overflow(page)).toBe(0);
});
