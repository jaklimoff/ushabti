import { expect, test, type Page } from "@playwright/test";
import {
  card,
  choose,
  column,
  columnOrder,
  createProject,
  gotoSettings,
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
 * button twice makes nothing twice. What a card brings and what a rule keeps
 * out are `import-route.test.ts`; the page on a phone is `ImportPanel.test.tsx`.
 */
const FIXTURE = "src/test/fixtures/trello-small.json";

/**
 * Opens the page and waits until it can take a file.
 *
 * The box is drawn on the server as well, and a file picked before React has
 * taken the page over goes nowhere. So the page shuts the box until then and
 * says why, and the test waits for it to open rather than for a stream or a
 * clock — the thing on screen is the thing to wait for.
 */
async function openImport(page: Page, projectId: string) {
  await gotoSettings(page, projectId, "import");
  await expect(page.getByLabel("The Trello export to bring in")).toBeEnabled();
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
  await expect(mapping(page, "in progress")).toHaveAttribute("data-value", /[0-9a-f-]{36}/);
  // One nothing matches is proposed as a new column.
  await expect(mapping(page, "To do")).toHaveAttribute("data-value", "");

  /* The owner points that list at an option the board already has. This is
     the one thing the preview exists for. */
  await settles(page, /\/import\/preview$/, async () => {
    await choose(mapping(page, "To do"), "Todo");
  });
  await expect(mapping(page, "To do")).toHaveAttribute("data-value", /[0-9a-f-]{36}/);

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
