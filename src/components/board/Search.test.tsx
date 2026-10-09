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
});
