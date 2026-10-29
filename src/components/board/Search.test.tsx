import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import type { BoardData } from "@/lib/types";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * The box that finds a task, and its list. Each test here was a test of
 * `e2e/search.spec.ts`, and its name is the name it had there; the two with
 * `@smoke` on them stayed end to end. What a set of words finds is
 * `searchTasks()`'s, which has unit tests of its own.
 */

const byTestId = (id: string) => page.getByTestId(id);
const box = () => byTestId("search-box");
const hits = () => byTestId("search-hit");
const hit = (title: string) => hits().filter({ hasText: title });

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/** The element's words hold `text`. `toHaveTextContent` asks for all of them. */
async function says(locator: Locator, text: string) {
  await expect.poll(() => locator.element().textContent ?? "").toContain(text);
}

async function find(words: string) {
  await box().fill(words);
  await expect.element(byTestId("search-hits")).toBeVisible();
}

async function hitCount(count: number) {
  await expect.poll(() => hits().elements().length).toBe(count);
}

async function draw(data: BoardData) {
  return renderWithBoard(<BoardShell initialTask={null} />, data, serving(data).answer);
}

describe("Finding a task", () => {
  test("every word has to be somewhere, and the arrows pick between what is left", async () => {
    const data = newProject();
    withTask(data, "Log in with a passkey", { Status: "Todo" });
    withTask(data, "Write the login guide", { Status: "Todo" });
    await draw(data);

    await find("log");
    await hitCount(2);

    // A second word narrows; it never widens.
    await find("log guide");
    await hitCount(1);

    await find("log");
    await hitCount(2);
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await expect.element(byTestId("task-title")).toHaveValue("Write the login guide");
  });

  /* The spec typed the description in the panel; typing it is the panel's
     own test, so here the task arrives with it. */
  test("finds words in the description and shows the line they are on", async () => {
    const data = newProject();
    const task = withTask(data, "Nothing in the title", { Status: "Todo" });
    task.description = "The queue survives a reload.";
    await draw(data);

    await find("queue");
    await says(hits().first(), "Nothing in the title");
    // The row says why it is a hit.
    await says(hits().first(), "The queue survives a reload.");
  });

  test("a hit the view is hiding says so, and still opens", async () => {
    const data = newProject();
    withTask(data, "Urgent thing", { Status: "Todo", Priority: "Urgent" });
    withTask(data, "Ordinary thing", { Status: "Todo" });
    await draw(data);

    await byTestId("filter-button").click();
    await byTestId("filter-search").fill("Priority");
    await userEvent.keyboard("{Enter}");
    await byTestId("filter-box").fill("Urgent");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Escape}");
    await expect.element(byTestId("task-count")).toHaveTextContent("1 of 2 tasks");

    // A search reaches past the filter, because it hides nothing itself.
    await find("thing");
    await hitCount(2);
    await says(hit("Ordinary thing"), "not in this view");
    expect(hit("Urgent thing").element().textContent).not.toContain("not in this view");

    await hit("Ordinary thing").click();
    await expect.element(byTestId("task-title")).toHaveValue("Ordinary thing");
  });

  test("`/` opens the box, Escape puts the list away, and nothing is found in an empty box", async () => {
    const data = newProject();
    withTask(data, "Something to find", { Status: "Todo" });
    await draw(data);

    // Nothing has the focus: the slash has to reach the board from the page.
    await byTestId("task-count").click();
    await userEvent.keyboard("/");
    await expect.element(box()).toHaveFocus();
    // The slash opened the box; it did not land in it.
    await expect.element(box()).toHaveValue("");
    await gone(byTestId("search-hits"));

    await userEvent.keyboard("someth");
    await hitCount(1);

    await userEvent.keyboard("{Escape}");
    await gone(byTestId("search-hits"));
    // Escape closed the list and left the board alone.
    await gone(byTestId("task-panel"));

    await find("nothing by this name");
    await hitCount(0);
    await says(byTestId("search-hits"), "No task by those words.");
  });
  /* The box keeps the focus, so the browser never scrolls the list for the
     highlight. */
  test("the arrows keep the highlighted hit in sight past the 8th", async () => {
    const data = newProject();
    // A hit in the words draws the line it is on, which makes each row taller.
    for (let i = 1; i <= 12; i++) {
      withTask(data, `Part ${i}`, { Status: "Todo" }).description = `The plan for part ${i}.`;
    }
    await draw(data);

    await find("plan");
    await hitCount(12);
    const list = byTestId("search-hits").getByRole("listbox").element();
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);

    const inSight = () => {
      const id = box().element().getAttribute("aria-activedescendant");
      const row = document.getElementById(id ?? "")!.getBoundingClientRect();
      const edge = list.getBoundingClientRect();
      return row.top >= edge.top - 0.5 && row.bottom <= edge.bottom + 0.5;
    };
    for (let i = 0; i < 11; i++) await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => box().element().getAttribute("aria-activedescendant")).toMatch(/-11$/);
    await expect.poll(inSight).toBe(true);

    // A wrap goes back to the top.
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(inSight).toBe(true);
    expect(list.scrollTop).toBe(0);
  });

  test("a list cut short says how many it found, and a narrower word takes the line away", async () => {
    const data = newProject();
    for (let i = 1; i <= 60; i++) {
      withTask(data, `Batch ${i <= 8 ? "alpha" : "beta"} ${i}`, { Status: "Todo" });
    }
    await draw(data);

    await find("batch");
    await hitCount(12);
    await expect.element(byTestId("search-count")).toHaveTextContent("12 of 60");
    // The line sits outside the scroller, so it never scrolls away.
    expect(
      byTestId("search-hits")
        .getByRole("listbox")
        .element()
        .contains(byTestId("search-count").element()),
    ).toBe(false);

    await find("batch alpha");
    await hitCount(8);
    await gone(byTestId("search-count"));
  });
});

/*
 * The board carries an archived task without its description, so the words in
 * those are asked of the server, and what it finds joins the bottom of the
 * list. `held` keeps that answer back until the test lets it go, which is how
 * an answer arrives late.
 */
describe("Finding an archived task", () => {
  const SEARCH = /^\/api\/projects\/[0-9a-f-]+\/search$/;

  function archive(data: BoardData, title: string) {
    const number = data.tasks.length + data.archived.length + 1;
    const row = {
      id: crypto.randomUUID(),
      number,
      key: `${data.project.key}-${number}`,
      title,
      position: `a${number}`,
      archivedAt: "2026-09-01T10:00:00.000Z",
      shippedIn: null,
    };
    data.archived.push(row);
    return row;
  }

  async function drawWith(
    data: BoardData,
    found: (q: string) => { hits: { task: unknown; snippet: string | null }[]; total: number },
  ) {
    const served = serving(data).answer;
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    const asked: string[] = [];
    const drawn = await renderWithBoard(<BoardShell initialTask={null} />, data, (sent) =>
      SEARCH.test(sent.path) ? { body: found(sent.query.get("q") ?? "") } : served(sent),
    );
    const inner = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (SEARCH.test(new URL(String(input), window.location.origin).pathname)) {
        asked.push(String(input));
        await held;
      }
      return inner(input, init);
    };
    return { drawn, release, asked };
  }

  test("an archived task is found by its key or its title before the server answers", async () => {
    const data = newProject();
    withTask(data, "Open work", { Status: "Todo" });
    const old = archive(data, "Old passkey work");
    await drawWith(data, () => ({ hits: [], total: 0 }));

    // The server is held, and the title still finds it.
    await find("passkey");
    await hitCount(1);
    await says(hit("Old passkey work"), "archived");

    await find(old.key);
    await says(hits().first(), "Old passkey work");
  });

  test("a word in an archived description is found on the server, with its line", async () => {
    const data = newProject();
    const old = archive(data, "Nothing in the title");
    const { release, asked } = await drawWith(data, (q) => ({
      hits: q.includes("queue")
        ? [
            {
              task: { ...old },
              snippet: "The queue survives a reload.",
            },
          ]
        : [],
      total: q.includes("queue") ? 1 : 0,
    }));

    await find("queue");
    await says(byTestId("search-hits"), "Looking through the archive…");
    release();
    await hitCount(1);
    await says(hits().first(), "Nothing in the title");
    await says(hits().first(), "archived");
    await says(hits().first(), "The queue survives a reload.");
    expect(asked.some((url) => url.includes("q=queue"))).toBe(true);
  });

  test("archived hits from the server sit below the rest, and the count takes them in", async () => {
    const data = newProject();
    for (let i = 1; i <= 12; i++) withTask(data, `Queue part ${i}`, { Status: "Todo" });
    const old = archive(data, "Long gone");
    const { release } = await drawWith(data, () => ({
      hits: [{ task: { ...old }, snippet: "the queue" }],
      total: 3,
    }));

    await find("queue");
    await hitCount(12);
    release();
    await expect.element(byTestId("search-count")).toHaveTextContent("12 of 15");
    // The box is full of better hits, so the archived one is counted, not drawn.
    await gone(hit("Long gone"));
  });

  test("a late archived hit joins below, and the highlighted row stays where it is", async () => {
    const data = newProject();
    withTask(data, "Queue one", { Status: "Todo" });
    withTask(data, "Queue two", { Status: "Done" });
    const old = archive(data, "Long gone");
    const { release } = await drawWith(data, () => ({
      hits: [{ task: { ...old }, snippet: "the queue" }],
      total: 1,
    }));

    await find("queue");
    await hitCount(2);
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => box().element().getAttribute("aria-activedescendant")).toMatch(/-1$/);
    await says(hits().nth(1), "Queue two");

    release();
    await hitCount(3);
    // Open, then done, then archived.
    await says(hits().nth(0), "Queue one");
    await says(hits().nth(1), "Queue two");
    await says(hits().nth(2), "Long gone");
    expect(box().element().getAttribute("aria-activedescendant")).toMatch(/-1$/);
    expect(hits().nth(1).element().getAttribute("aria-selected")).toBe("true");

    await userEvent.keyboard("{Enter}");
    await expect.element(byTestId("task-title")).toHaveValue("Queue two");
  });
});
