import { expect, test, type Page } from "@playwright/test";
import {
  addListView,
  addTask,
  card,
  createProject,
  gotoSettings,
  listRow,
  register,
  saved,
  unique,
} from "./helpers";

const PR = "https://github.com/acme/shop/pull/12";
const ISSUE = "https://github.com/acme/shop/issues/7";

/** Makes a Link property in Settings, and reads the hint that names it. */
async function addLinkProperty(page: Page, projectId: string, name: string) {
  await gotoSettings(page, projectId);
  await page.getByLabel("New property name").fill(name);
  await page.getByLabel("Type of the new property").selectOption({ label: "Link" });
  await expect(page.getByText("Web addresses, such as a pull request.")).toBeVisible();
  await page.getByRole("button", { name: "Add property" }).click();
  await expect(page.getByLabel(`Name of the ${name} property`)).toHaveValue(name);
}

/** The links of the open task, as the panel draws them. */
function panelLinks(page: Page, name: string) {
  return page.getByRole("group", { name }).getByRole("link");
}

async function pasteLink(page: Page, name: string, url: string) {
  const box = page.getByLabel(`Add a link to ${name}`);
  await box.fill(url);
  await saved(page, () => box.press("Enter"));
}

test.describe("A Link property", () => {
  test("a person adds and removes a link in the panel, and it opens in a new tab", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Links"));
    await addLinkProperty(page, projectId, "Pull requests");

    await page.goto(`/p/${projectId}`);
    await addTask(page, "Todo", "Another task");
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "Todo", "Ship the cart");

    await pasteLink(page, "Pull requests", PR);
    await pasteLink(page, "Pull requests", ISSUE);
    /* The same pull request with a fragment is the same pull request. */
    await page.getByLabel("Add a link to Pull requests").fill(`${PR}#issuecomment-1`);
    await page.getByLabel("Add a link to Pull requests").press("Enter");

    const links = panelLinks(page, "Pull requests");
    await expect(links).toHaveText(["acme/shop#12", "acme/shop#7"]);
    await expect(links.first()).toHaveAttribute("href", PR);
    await expect(links.first()).toHaveAttribute("target", "_blank");
    await expect(links.first()).toHaveAttribute("rel", /noopener/);

    /* A real link: pressing it opens the pull request in a new tab. */
    await page
      .context()
      .route("https://github.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "<p>a pull request</p>" }),
      );
    const [tab] = await Promise.all([page.context().waitForEvent("page"), links.first().click()]);
    expect(tab.url()).toBe(PR);
    await tab.close();

    /* A link the server would refuse stays in the box with the reason. */
    await page.getByLabel("Add a link to Pull requests").fill("javascript:alert(1)");
    await page.getByLabel("Add a link to Pull requests").press("Enter");
    await expect(
      page.getByRole("alert").filter({ hasText: "Pull requests takes only http and https links." }),
    ).toBeVisible();
    /* What was typed belongs to one task: the next task opens with an empty box. */
    await card(page, "Another task").click();
    await expect(page.getByLabel("Add a link to Pull requests")).toHaveValue("");
    await expect(page.getByText("Pull requests takes only http and https links.")).toHaveCount(0);
    await card(page, "Ship the cart").click();

    await saved(page, () => page.getByRole("button", { name: "Remove acme/shop#12" }).click());
    await expect(links).toHaveText(["acme/shop#7"]);

    /* What was saved is what the server holds. */
    await page.reload();
    await card(page, "Ship the cart").click();
    await expect(panelLinks(page, "Pull requests")).toHaveText(["acme/shop#7"]);
  });

  test("starts off the card, then shows the first link and +N on the card and in a list", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Chip"));
    await addLinkProperty(page, projectId, "Pull requests");

    await page.goto(`/p/${projectId}`);
    await addTask(page, "Todo", "Two pull requests");
    await pasteLink(page, "Pull requests", PR);
    await pasteLink(page, "Pull requests", ISSUE);
    await page.getByRole("button", { name: "Close task" }).click();

    const chips = card(page, "Two pull requests").getByTestId("card-chip");
    await expect(chips.filter({ hasText: "acme/shop" })).toHaveCount(0);

    await gotoSettings(page, projectId, "card");
    const row = page.getByTestId("card-row").filter({
      has: page.getByRole("button", { name: /^Pull requests on the card/ }),
    });
    await expect(row).toHaveAttribute("data-place", "off");
    await row.getByRole("button", { name: /^Pull requests on the card/ }).click();
    await saved(page, () =>
      page.getByRole("button", { name: "Put Pull requests in the footer right" }).click(),
    );

    await page.goto(`/p/${projectId}`);
    const chip = card(page, "Two pull requests").getByTestId("card-chip").filter({
      hasText: "acme/shop",
    });
    await expect(chip).toHaveText("acme/shop#12 +1");
    await expect(chip.getByRole("link")).toHaveCount(0);

    /* A click on the chip still opens the task. */
    await chip.click();
    await expect(panelLinks(page, "Pull requests")).toHaveText(["acme/shop#12", "acme/shop#7"]);
    await page.getByRole("button", { name: "Close task" }).click();

    await addListView(page, "Rows");
    await expect(listRow(page, "Two pull requests")).toContainText("acme/shop#12 +1");
  });
});
