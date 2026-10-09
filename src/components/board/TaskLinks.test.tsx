import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import type { BoardData, TaskDTO } from "@/lib/types";
import { newProject, optionOf, propertyOf, renderWithBoard, withTask } from "@/test/board";
import { linking } from "@/test/links";
import { BoardShell } from "./BoardApp";

/*
 * What a task waits on and what it is part of, in the panel and on the card.
 * Each test here was a test of `e2e/blockers.spec.ts` or `e2e/parents.spec.ts`,
 * and its name is the name it had there. The server's half — the chain the
 * board read works out, being over, one level deep and the count of parts —
 * is `links-route.test.ts`; the fake here answers with the same sentences.
 */

const BLOCKERS = /^\/api\/tasks\/[0-9a-f-]+\/blockers$/;
const BLOCKER = /^\/api\/tasks\/[0-9a-f-]+\/blockers\/[0-9a-f-]+$/;
const PARENT = /^\/api\/tasks\/[0-9a-f-]+\/parent$/;
const LENS = /^\/api\/views\/[0-9a-f-]+\/lens$/;

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const close = () => page.getByRole("button", { name: "Close task" }).click();

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/** The element's words hold `text`. `toHaveTextContent` asks for all of them. */
async function says(locator: Locator, text: string) {
  await expect.poll(() => locator.element().textContent ?? "").toContain(text);
}

async function draw(data: BoardData, fake = linking(data)) {
  const drawn = await renderWithBoard(<BoardShell initialTask={null} />, data, fake.answer);
  return { ...drawn, fake };
}

/** Opens a task by its card, and waits for the panel to read it. */
async function open(task: TaskDTO) {
  await card(task.title).click();
  await expect.element(byTestId("task-key")).toHaveTextContent(task.key);
}

/** The e2e helper `sayItWaitsOn`: the menu, the box, the key and Enter. */
async function pick(item: "add-blocker" | "add-parent" | "add-child", key: string) {
  await page.getByRole("button", { name: "Task menu" }).click();
  await byTestId(item).click();
  const way = { "add-blocker": "blockedBy", "add-parent": "parent", "add-child": "children" }[item];
  await byTestId(`link-search-${way}`).fill(key);
  /* The rows are worked out from the box, so wait for the one Enter takes. */
  await expect.element(byTestId(`links-${way}`).getByRole("option").first()).toBeVisible();
  await userEvent.keyboard("{Enter}");
}

/** Puts the keyboard on a button once it is drawn. */
async function focus(button: Locator) {
  await expect.element(button).toBeVisible();
  (button.element() as HTMLElement).focus();
}

/** Archives the open task from its menu. */
async function archiveOpen() {
  await page.getByRole("button", { name: "Task menu" }).click();
  await byTestId("archive-task").click();
  await expect.element(byTestId("archived-row")).toBeVisible();
}

describe("What a task waits on", () => {
  test("a blocker puts a chain on the card, and being over takes it off", async () => {
    const data = newProject();
    const ship = withTask(data, "Ship the thing", { Status: "Todo" });
    const wire = withTask(data, "Wire the queue", { Status: "Todo" });
    const plumb = withTask(data, "Plumb the drain", { Status: "Todo" });
    const { sent } = await draw(data);

    /* Nothing at rest: a task with no links draws no heading at all, which is
       why the way in is the menu. */
    await open(ship);
    await gone(byTestId("task-links"));

    await pick("add-blocker", wire.key);
    await expect.poll(() => sent("POST", BLOCKERS).length).toBe(1);
    expect(sent("POST", BLOCKERS)[0].body).toEqual({ blockerId: wire.id });
    await expect.element(byTestId("links-blockedBy")).toBeVisible();
    await says(byTestId("link-row"), "Wire the queue");
    await close();

    /* One glyph on the card, and nothing else: no list, no count. It is drawn
       rather than typed, because the character for it is in none of the fonts
       this board asks for and Chromium drew the missing-glyph box. */
    const chain = card("Ship the thing").getByTestId("card-chain");
    await expect.element(chain).toBeVisible();
    expect(chain.element().querySelectorAll("svg")).toHaveLength(1);
    await expect.element(chain).toHaveAttribute("title", `Blocked by ${wire.key}`);
    await gone(card("Plumb the drain").getByTestId("card-chain"));

    /* The other end of the chain says so on the other task. */
    await open(wire);
    await says(byTestId("links-blocks"), "Ship the thing");

    await pick("add-blocker", plumb.key);
    await expect.poll(() => sent("POST", BLOCKERS).length).toBe(2);
    await expect.element(byTestId("links-blockedBy").getByTestId("link-row")).toBeVisible();
    await close();

    /* A circle is refused with one sentence, in the row. */
    await open(plumb);
    await pick("add-blocker", ship.key);
    await expect
      .element(byTestId("link-refused"))
      .toHaveTextContent(`${ship.key} already waits on ${plumb.key}, so this would be a circle.`);
    /* The box stayed open and nothing landed in the list under it. */
    await expect.element(byTestId("link-search-blockedBy")).toBeVisible();
    await gone(byTestId("links-blockedBy").getByTestId("link-row"));
    await close();

    /* "Blocked" is a rule like any other, and it is not a property: nobody
       added one and nothing writes one. */
    await byTestId("filter-button").click();
    await byTestId("filter-search").fill("Blocked");
    await userEvent.keyboard("{Enter}");
    await byTestId("filter-box").fill("Blocked");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Escape}");
    await gone(byTestId("filter-menu"));
    await expect.element(card("Ship the thing")).toBeVisible();
    await expect.element(card("Wire the queue")).toBeVisible();
    await gone(card("Plumb the drain"));
    const lensWrites = sent("PUT", LENS).length;
    await page.getByRole("button", { name: "Remove the filter Blocked" }).click();
    await expect.poll(() => sent("PUT", LENS).length).toBe(lensWrites + 1);
    await expect.element(card("Plumb the drain")).toBeVisible();

    /* Archived is what over means, so the glyph goes without anybody touching
       the link: archiving its blocker reads the board again. */
    await open(wire);
    await archiveOpen();
    await close();
    await expect.element(card("Ship the thing")).toBeVisible();
    await gone(card("Ship the thing").getByTestId("card-chain"));

    /* The link is still there. It is over, not gone — struck through, and the
       ✕ that takes it away is where it always was. */
    await open(ship);
    await says(byTestId("link-row"), "Wire the queue");
    await page.getByRole("button", { name: `Unlink ${wire.key}` }).click();
    await expect.poll(() => sent("DELETE", BLOCKER).length).toBe(1);
    await gone(byTestId("task-links"));
  });

  test("a row opens the task it names, and the ✕ only unlinks", async () => {
    const data = newProject();
    const ship = withTask(data, "Ship the thing", { Status: "Todo" });
    const wire = withTask(data, "Wire the queue", { Status: "Todo" });
    const fake = linking(data);
    fake.blockedBy(ship, wire);
    const { sent } = await draw(data, fake);

    const opener = (list: string, task: TaskDTO) =>
      byTestId(list).getByRole("button", { name: `Open ${task.key} ${task.title}` });
    const key = byTestId("task-key");

    /* A Blocked by row opens the task it waits on, as a key in the words does. */
    await open(ship);
    await opener("links-blockedBy", wire).click();
    await expect.element(key).toHaveTextContent(wire.key);

    /* A Blocks row opens the task that waits, and the keyboard reaches it. */
    await focus(opener("links-blocks", ship));
    await userEvent.keyboard("{Enter}");
    await expect.element(key).toHaveTextContent(ship.key);

    /* A task that is over still has a panel, so its row opens it too. */
    await close();
    await open(wire);
    await archiveOpen();
    await close();

    await open(ship);
    await focus(opener("links-blockedBy", wire));
    await userEvent.keyboard(" ");
    await expect.element(key).toHaveTextContent(wire.key);
    await expect.element(byTestId("archived-row")).toBeVisible();

    /* The ✕ takes the link away and opens nothing. */
    await opener("links-blocks", ship).click();
    await expect.element(key).toHaveTextContent(ship.key);
    await page.getByRole("button", { name: `Unlink ${wire.key}` }).click();
    await expect.poll(() => sent("DELETE", BLOCKER).length).toBe(1);
    await gone(byTestId("task-links"));
    await expect.element(key).toHaveTextContent(ship.key);
  });

  test("a task is never offered as its own blocker", async () => {
    const data = newProject();
    const only = withTask(data, "Only task", { Status: "Todo" });
    await draw(data);
    await open(only);

    await page.getByRole("button", { name: "Task menu" }).click();
    await byTestId("add-blocker").click();
    /* An empty box has asked for nothing, so it does not say nothing was found. */
    await expect.element(byTestId("link-search-blockedBy")).toBeVisible();
    expect(byTestId("links-blockedBy").element().textContent).not.toContain("No task");
    await byTestId("link-search-blockedBy").fill(only.key);
    /* The task itself is never in the list, so there is nothing to press: the
       box says so rather than offering a row that would be refused. */
    await says(byTestId("links-blockedBy"), "No task by that name.");
  });
});

describe("What a task is part of", () => {
  test("the panel sets a parent, lists the parts, and a part is never a blocker", async () => {
    const data = newProject();
    const epic = withTask(data, "The whole epic", { Status: "Todo" });
    const one = withTask(data, "Part one", { Status: "Todo" });
    const two = withTask(data, "Part two", { Status: "Todo" });
    const side = withTask(data, "Side work", { Status: "Todo" });
    const { sent } = await draw(data);

    await open(one);
    await pick("add-parent", epic.key);
    await expect.poll(() => sent("PUT", PARENT).length).toBe(1);
    expect(sent("PUT", PARENT)[0].body).toEqual({ parentId: epic.id });
    const parentList = byTestId("links-parent");
    await expect.element(parentList.getByTestId("link-row")).toBeVisible();
    await says(parentList, "The whole epic");

    /* A part is not a blocker: no Blocked by, and no chain on either card. */
    await gone(byTestId("links-blockedBy"));
    await close();
    await gone(card("Part one").getByTestId("card-chain"));
    await gone(card("The whole epic").getByTestId("card-chain"));

    /* The Parent row opens the parent, and it lists its parts. */
    await open(one);
    await parentList.getByRole("button", { name: `Open ${epic.key} The whole epic` }).click();
    await expect.element(byTestId("task-key")).toHaveTextContent(epic.key);
    const children = byTestId("links-children");
    await expect.poll(() => children.getByTestId("link-row").elements().length).toBe(1);
    await gone(byTestId("links-blocks"));

    /* The parent may wait on its own part: the parent row is not in the
       circle check, so this is no circle. */
    await pick("add-blocker", one.key);
    await expect.poll(() => sent("POST", BLOCKERS).length).toBe(1);
    await gone(byTestId("link-refused"));
    await expect.element(byTestId("links-blockedBy").getByTestId("link-row")).toBeVisible();

    /* A second part by the menu, and the parts are in board order. It had
       another parent, and the panel says where it left. */
    await close();
    await open(two);
    await pick("add-parent", side.key);
    await expect.poll(() => sent("PUT", PARENT).length).toBe(2);
    await close();
    await open(epic);
    await pick("add-child", two.key);
    await expect
      .element(byTestId("toast"))
      .toHaveTextContent(`${two.key} left ${side.key} and is now part of this task.`);
    await expect.poll(() => children.getByTestId("link-row").elements().length).toBe(2);
    await says(children.getByTestId("link-row").nth(0), "Part one");
    await says(children.getByTestId("link-row").nth(1), "Part two");

    /* A part that is over is struck through, and its row still opens it. */
    await close();
    await open(two);
    await archiveOpen();
    await close();

    await open(epic);
    const over = children.getByRole("button", { name: `Open ${two.key} Part two` });
    const title = (button: Locator) => button.element().querySelectorAll("span")[1].className;
    await expect.poll(() => title(over)).toMatch(/linkOver/);
    expect(title(children.getByRole("button", { name: `Open ${one.key} Part one` }))).not.toMatch(
      /linkOver/,
    );
    await over.click();
    await expect.element(byTestId("task-key")).toHaveTextContent(two.key);
    await expect.element(byTestId("archived-row")).toBeVisible();

    /* A part cannot have parts: refused in the row, with one sentence. */
    await close();
    await open(one);
    await pick("add-child", two.key);
    await expect
      .element(byTestId("link-refused"))
      .toHaveTextContent(`${one.key} is part of ${epic.key}, so it cannot have parts of its own.`);

    /* The ✕ takes the part out of its parent. */
    await parentList.getByRole("button", { name: `Unlink ${epic.key}` }).click();
    await gone(parentList);
    expect(sent("DELETE", PARENT)).toHaveLength(1);
    /* The blocker of the same two tasks is still there. */
    await expect.element(byTestId("links-blocks").getByTestId("link-row")).toBeVisible();
  });

  test("a parent says how many of its parts are done, on the card, in the list and in the panel", async () => {
    const data = newProject();
    const status = propertyOf(data, "Status");
    const shipped = optionOf(data, "Status", "Shipped");
    data.project.doneWhen = { propertyId: status.id, optionIds: [shipped] };
    /* A list beside the board, to read the same count in a row. */
    data.views.push({
      ...data.views[0],
      id: "00000000-0000-4000-8000-777777777777",
      name: "Everything",
      kind: "list",
      position: "z0000000",
      isDefault: false,
    });
    const epic = withTask(data, "The epic", { Status: "Backlog" });
    const lone = withTask(data, "A lone task", { Status: "Backlog" });
    const parts = (
      [
        ["Part A", "Shipped"],
        ["Part B", "Shipped"],
        ["Part D", "Backlog"],
        ["Part E", "Backlog"],
      ] as const
    ).map(([title, s]) => withTask(data, title, { Status: s }));
    const fake = linking(data);
    for (const part of parts) fake.partOf(part, epic);
    const { ring } = await draw(data, fake);

    const count = (title: string) =>
      card(title)
        .getByTestId("card-chip")
        .filter({ hasText: /^\d+\/\d+$/ });
    await expect.element(count("The epic")).toHaveTextContent("2/4");
    await expect.element(count("The epic")).toHaveAttribute("title", "Children · 2/4");
    await gone(count("A lone task"));

    /* A part moved to done somewhere else changes the parent's card at the
       next read, which the doorbell asks for. */
    fake.server.tasks.find((t) => t.id === parts[2].id)!.values[status.id] = shipped;
    ring();
    await expect.element(count("The epic")).toHaveTextContent("3/4");

    /* What the person does in this tab moves the count too: this tab drops
       the doorbell of its own writes, so the store has to read again. */
    await open(parts[3]);
    await archiveOpen();
    await close();
    await expect.element(count("The epic")).toHaveTextContent("4/4");

    /* A deleted part is not counted at all. */
    await open(parts[1]);
    await page.getByRole("button", { name: "Task menu" }).click();
    await page.getByRole("button", { name: "Delete task" }).click();
    await gone(card("Part B"));
    await expect.element(count("The epic")).toHaveTextContent("3/3");

    /* A part added from the panel joins the count. */
    await open(epic);
    await pick("add-child", lone.key);
    await expect
      .element(byTestId("links-children").getByText("Children · 3 of 4 done"))
      .toBeVisible();
    await close();
    await expect.element(count("The epic")).toHaveTextContent("3/4");

    await byTestId("view-pill").filter({ hasText: "Everything" }).click();
    await expect
      .element(
        byTestId("list-row")
          .filter({ hasText: "The epic" })
          .getByTestId("card-chip")
          .filter({ hasText: "3/4" }),
      )
      .toBeVisible();
  });
});
