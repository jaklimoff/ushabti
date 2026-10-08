import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { BoardData, PropertyDTO } from "@/lib/types";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * A Link property: what the panel and the card draw of one. Each test was a
 * test of `e2e/links.spec.ts`, and its name is the name it had there. Making
 * the property is Settings, and putting it on the card is the card view page,
 * which `CardViewPanel.test.tsx` holds; here the board arrives with both.
 */

const PR = "https://github.com/acme/shop/pull/12";
const ISSUE = "https://github.com/acme/shop/issues/7";
const LIST_ID = "00000000-0000-4000-8000-999999999999";
const VALUE = /^\/api\/tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+$/;

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const panelLinks = (name: string) => page.getByRole("group", { name }).getByRole("link");
const linkTexts = (name: string) =>
  panelLinks(name)
    .elements()
    .map((el) => el.textContent);

/**
 * A Link property added after the project was made, as Settings adds one. The
 * card view was arranged before it, so it has no row and starts off the card.
 */
function withLinks(data: BoardData, name: string): PropertyDTO {
  const property: PropertyDTO = {
    id: "00000000-0000-4000-8000-aaaaaaaaaaaa",
    name,
    type: "link",
    position: "z0000000",
    config: {},
    options: [],
  };
  data.properties.push(property);
  return property;
}

async function pasteLink(name: string, url: string) {
  await page.getByLabelText(`Add a link to ${name}`).fill(url);
  await userEvent.keyboard("{Enter}");
}

describe("A Link property", () => {
  test("a person adds and removes a link in the panel, and it opens in a new tab", async () => {
    const data = newProject();
    const links = withLinks(data, "Pull requests");
    withTask(data, "Another task", { Status: "Todo" });
    const ship = withTask(data, "Ship the cart", { Status: "Todo" });
    const server = serving(data);
    const { sent } = await renderWithBoard(
      <BoardShell initialTask={ship.key} />,
      data,
      server.answer,
    );

    await pasteLink("Pull requests", PR);
    await expect.poll(() => linkTexts("Pull requests")).toEqual(["acme/shop#12"]);
    await pasteLink("Pull requests", ISSUE);
    /* The same pull request with a fragment is the same pull request. */
    await pasteLink("Pull requests", `${PR}#issuecomment-1`);

    await expect.poll(() => linkTexts("Pull requests")).toEqual(["acme/shop#12", "acme/shop#7"]);
    const first = panelLinks("Pull requests").first();
    await expect.element(first).toHaveAttribute("href", PR);
    /* A real link that opens a new tab is an anchor that says so: the
       browser does the rest, which needs no tab of its own to prove. */
    await expect.element(first).toHaveAttribute("target", "_blank");
    await expect.element(first).toHaveAttribute("rel", expect.stringMatching(/noopener/));
    // The fragment wrote nothing.
    expect(sent("PUT", VALUE)).toHaveLength(2);

    /* A link the server would refuse stays in the box with the reason. */
    await pasteLink("Pull requests", "javascript:alert(1)");
    await expect
      .element(
        page
          .getByRole("alert")
          .filter({ hasText: "Pull requests takes only http and https links." }),
      )
      .toBeVisible();
    expect(sent("PUT", VALUE)).toHaveLength(2);
    /* What was typed belongs to one task: the next task opens with an empty box. */
    await card("Another task").click();
    await expect.element(page.getByLabelText("Add a link to Pull requests")).toHaveValue("");
    await expect
      .element(page.getByText("Pull requests takes only http and https links."))
      .not.toBeInTheDocument();
    await card("Ship the cart").click();

    await page.getByRole("button", { name: "Remove acme/shop#12" }).click();
    await expect.poll(() => linkTexts("Pull requests")).toEqual(["acme/shop#7"]);

    /* What was saved is what the server was sent, last. */
    await expect.poll(() => sent("PUT", VALUE).length).toBe(3);
    expect(sent("PUT", VALUE).map((r) => [r.path.endsWith(links.id), r.body])).toEqual([
      [true, { value: [PR] }],
      [true, { value: [PR, ISSUE] }],
      [true, { value: [ISSUE] }],
    ]);
  });

  test("starts off the card, then shows the first link and +N on the card and in a list", async () => {
    const data = newProject();
    const links = withLinks(data, "Pull requests");
    withTask(data, "Two pull requests", { Status: "Todo" }).values[links.id] = [PR, ISSUE];
    const linkChip = (title: string) =>
      card(title).getByTestId("card-chip").filter({ hasText: "acme/shop" });

    const off = await renderWithBoard(
      <BoardShell initialTask={null} />,
      data,
      serving(data).answer,
    );
    await expect.element(card("Two pull requests")).toBeVisible();
    expect(linkChip("Two pull requests").elements()).toHaveLength(0);
    await off.screen.unmount();

    // Somebody puts it in the footer, on the right.
    data.cardView = {
      ...data.cardView,
      rows: { ...data.cardView.rows, [links.id]: { place: "footerR", mode: "text" } },
    };
    data.views.push({
      ...data.views[0],
      id: LIST_ID,
      name: "Rows",
      kind: "list",
      position: "z0000000",
      isDefault: false,
    });
    await renderWithBoard(<BoardShell initialTask={null} />, data, serving(data).answer);

    const chip = linkChip("Two pull requests");
    await expect.element(chip).toHaveTextContent("acme/shop#12 +1");
    expect(chip.getByRole("link").elements()).toHaveLength(0);

    /* A click on the chip still opens the task. */
    await chip.click();
    await expect.poll(() => linkTexts("Pull requests")).toEqual(["acme/shop#12", "acme/shop#7"]);
    await page.getByRole("button", { name: "Close task" }).click();

    await byTestId("view-pill").filter({ hasText: "Rows" }).click();
    await expect
      .element(byTestId("list-row").filter({ hasText: "Two pull requests" }))
      .toMatchTextContent("acme/shop#12 +1");
  });
});
