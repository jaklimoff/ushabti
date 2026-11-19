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

  test("a link is edited in place: Enter and blur save it where it sits, Escape and empty put it back", async () => {
    const data = newProject();
    const links = withLinks(data, "Pull requests");
    const OTHER = "https://github.com/acme/shop/pull/99";
    const ship = withTask(data, "Ship the cart", { Status: "Todo" });
    ship.values[links.id] = [PR, ISSUE];
    const server = serving(data);
    const { sent } = await renderWithBoard(
      <BoardShell initialTask={ship.key} />,
      data,
      server.answer,
    );
    const pencil = (label: string) => page.getByRole("button", { name: `Edit ${label}` });
    const box = (label: string) => page.getByRole("textbox", { name: `Edit ${label}` });
    const values = () => sent("PUT", VALUE).map((r) => r.body);

    /* A click on the label is the link and starts no edit. */
    const label = panelLinks("Pull requests").first();
    await expect.element(label).toHaveAttribute("target", "_blank");
    label.element().addEventListener("click", (e) => e.preventDefault(), { once: true });
    await label.click();
    expect(box("acme/shop#12").elements()).toHaveLength(0);

    /* The pencil sits beside the ✕ and opens a box with the whole address,
       focused, the words picked. */
    await expect.element(page.getByRole("button", { name: "Remove acme/shop#12" })).toBeVisible();
    await pencil("acme/shop#12").click();
    const input = box("acme/shop#12");
    await expect.element(input).toHaveValue(PR);
    await expect.element(input).toHaveFocus();
    const el = input.element() as HTMLInputElement;
    expect(el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)).toBe(PR);

    /* Escape puts the old link back and writes nothing. */
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => linkTexts("Pull requests")).toEqual(["acme/shop#12", "acme/shop#7"]);
    await expect.element(pencil("acme/shop#12")).toHaveFocus();

    /* Empty puts it back too; removing is the ✕'s job. */
    await pencil("acme/shop#12").click();
    await box("acme/shop#12").fill("");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => linkTexts("Pull requests")).toEqual(["acme/shop#12", "acme/shop#7"]);

    /* Unchanged writes nothing. */
    await pencil("acme/shop#12").click();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => linkTexts("Pull requests")).toEqual(["acme/shop#12", "acme/shop#7"]);
    expect(values()).toEqual([]);

    /* A link the server would refuse stays in the box with the reason. */
    await pencil("acme/shop#12").click();
    await box("acme/shop#12").fill("ftp://acme.test/file");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(
        page
          .getByRole("alert")
          .filter({ hasText: "Pull requests takes only http and https links." }),
      )
      .toBeVisible();
    await expect.element(box("acme/shop#12")).toHaveValue("ftp://acme.test/file");

    /* A link already in the list, by another spelling, stays too. */
    await box("acme/shop#12").fill(`${ISSUE}#top`);
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("alert").filter({ hasText: "Pull requests already has this link." }))
      .toBeVisible();
    await expect.element(box("acme/shop#12")).toHaveValue(`${ISSUE}#top`);
    expect(values()).toEqual([]);

    /* Enter saves, and the link keeps its place. */
    await box("acme/shop#12").fill(OTHER);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => linkTexts("Pull requests")).toEqual(["acme/shop#99", "acme/shop#7"]);
    await expect.poll(() => values()).toEqual([{ value: [OTHER, ISSUE] }]);

    /* Blur saves as well. */
    await pencil("acme/shop#7").click();
    await box("acme/shop#7").fill(`${ISSUE}#x`);
    await page.getByLabelText("Add a link to Pull requests").click();
    await expect
      .poll(() => values())
      .toEqual([{ value: [OTHER, ISSUE] }, { value: [OTHER, `${ISSUE}#x`] }]);
    await expect.poll(() => linkTexts("Pull requests")).toEqual(["acme/shop#99", "acme/shop#7"]);
  });
});
