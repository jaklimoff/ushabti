import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { newProject, renderWithBoard, withAgent, withTask } from "@/test/board";
import { boxValue, serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * The `@` picker. An agent wakes on its own name, and a name with a space is
 * easy to mistype. So the proof is the written words: what the box holds
 * after Enter is what the watcher looks for. Each test was a test of
 * `e2e/mention.spec.ts`, and its name is the name it had there.
 */

const AGENT = "Night Builder";
const byTestId = (id: string) => page.getByTestId(id);
const list = () => byTestId("mention-list");
const rows = () => byTestId("mention-item");

/** A project with an agent in it, and one task open in the panel. */
async function askTheAgent(title = "Ask the agent", notes = 0) {
  const data = newProject();
  withAgent(data, AGENT);
  const task = withTask(data, title, { Status: "Todo" });
  const server = serving(data);
  for (let i = 1; i <= notes; i += 1) server.comment(task, `Note number ${i}`);
  const drawn = await renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer);
  await expect.element(byTestId("task-panel")).toBeVisible();
  return { ...drawn, ...server, task };
}

describe("Who an @ can name", () => {
  test("the list opens under the comment box, and Enter writes the whole name", async () => {
    await askTheAgent();

    const box = byTestId("comment-box");
    await box.click();
    await userEvent.keyboard("Please look, ");
    await expect.element(list()).not.toBeInTheDocument();

    // The agents come first: the mention is what wakes one.
    await userEvent.keyboard("@");
    await expect.element(list()).toBeVisible();
    await expect.element(rows().first()).toHaveAttribute("data-name", AGENT);
    await expect.poll(() => rows().elements().length).toBe(2);

    // The letters narrow it, by the start of any word in the name.
    await userEvent.keyboard("buil");
    await expect.poll(() => rows().elements().length).toBe(1);

    await userEvent.keyboard("{Enter}");
    await expect.element(list()).not.toBeInTheDocument();
    await expect.element(box).toHaveValue(`Please look, @${AGENT} `);

    await userEvent.keyboard("today");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect
      .element(byTestId("comment-markdown"))
      .toMatchTextContent(`Please look, @${AGENT} today`);
  });

  test("Escape closes the list and leaves the @, and no match closes it too", async () => {
    await askTheAgent();

    const box = byTestId("comment-box");
    await box.click();
    await userEvent.keyboard("@nig");
    await expect.element(list()).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.element(list()).not.toBeInTheDocument();
    // Escape belongs to the list while it is open. The words stay.
    await expect.element(box).toHaveValue("@nig");

    // Typing on with no match closes the list without a word.
    await userEvent.keyboard(" @zzz");
    await expect.element(list()).not.toBeInTheDocument();
  });

  test("the title and the description of the panel offer the same list", async () => {
    const { sent } = await askTheAgent();

    const title = byTestId("task-title");
    await title.click();
    await userEvent.keyboard("{End} @nig");
    await expect.element(list()).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(title).toHaveValue(`Ask the agent @${AGENT} `);

    // The name is saved like anything else typed in the box.
    (title.element() as HTMLElement).blur();
    await expect.element(byTestId("card").first()).toMatchTextContent(`@${AGENT}`);
    expect(sent("PATCH", /^\/api\/tasks\/[0-9a-f-]+$/)[0].body).toMatchObject({
      title: `Ask the agent @${AGENT}`,
    });

    await page.getByText("Add a description…").click();
    await expect.element(byTestId("live-editor")).toHaveFocus();
    await userEvent.keyboard("Over to @nig");
    await expect.element(list()).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.poll(boxValue).toBe(`Over to @${AGENT} `);
    (byTestId("live-editor").element() as HTMLElement).blur();
    await expect.element(byTestId("markdown")).toMatchTextContent(`Over to @${AGENT}`);
  });
});

/*
 * The comment box of a busy task sits on the bottom edge of the screen: the
 * panel body scrolls, and the box is the last thing in it. A list drawn under
 * that box is a list nobody can see, and Enter would then write a name that
 * was never on the screen.
 */
describe("A list with no room under the box", () => {
  test("opens upward, and every row is on the screen", async () => {
    await askTheAgent("A task with a few notes", 6);
    await expect.element(byTestId("comment").nth(5)).toBeVisible();

    const box = byTestId("comment-box");
    await box.click();
    await userEvent.keyboard("@");
    await expect.poll(() => rows().elements().length).toBe(2);

    for (const row of rows().elements()) {
      const at = row.getBoundingClientRect();
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.y + at.height).toBeLessThanOrEqual(window.innerHeight);
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.x + at.width).toBeLessThanOrEqual(window.innerWidth);
    }

    // Drawn is not the same as reachable: an ancestor that scrolls would clip
    // the rows without moving them.
    await rows().first().click();
    await expect.element(box).toHaveValue(`@${AGENT} `);
  });
});
