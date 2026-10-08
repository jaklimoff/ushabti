import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import type { BoardData, CommentDTO, TaskDTO } from "@/lib/types";
import { detailOf, ME, newProject, renderWithBoard, withTask, type Answer } from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * How long words lie on the board: a title on a card and in a row, a line of
 * Markdown in a description and a comment, and the composer as it grows.
 * Each test here was a test of `e2e/long-title.spec.ts`,
 * `e2e/markdown-wrap.spec.ts` or `e2e/composer.spec.ts`, and its name is the
 * name it had there. Browser Mode has the real CSS, so the measures are the
 * ones the spec took.
 */

const LIST_ID = "00000000-0000-4000-8000-777777777777";

/** A task opened from the board is the one on it, with these comments. */
function serving(data: BoardData, comments: CommentDTO[] = []): Answer {
  return ({ method, path }) => {
    const asked = /^\/api\/tasks\/([0-9a-f-]+)$/.exec(path);
    if (method === "GET" && asked) {
      const task = data.tasks.find((t) => t.id === asked[1]);
      if (task) return { body: { task: detailOf(task, { comments }) } };
    }
  };
}

/** A list view called `name`, beside the board. */
function withList(data: BoardData, name: string) {
  data.views.push({
    ...data.views[0],
    id: LIST_ID,
    name,
    kind: "list",
    position: "z0000000",
    isDefault: false,
  });
}

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const listRow = (title: string) => byTestId("list-row").filter({ hasText: title });
const html = (locator: Locator) => locator.element() as HTMLElement;

afterEach(async () => {
  await page.viewport(1440, 900);
});

/** How many lines a box draws, from its height and its own line height. */
function linesOf(box: Locator): number {
  const node = html(box);
  const lineHeight = parseFloat(getComputedStyle(node).lineHeight);
  return Math.round(node.getBoundingClientRect().height / lineHeight);
}

// As long as a title may be: 400 characters.
const LONG_TITLE = `A long title ${"that keeps on going ".repeat(20)}`.slice(0, 400);

describe("A long title", () => {
  test("is cut to three lines on a card, and the whole of it is a hover away", async () => {
    const data = newProject();
    withTask(data, LONG_TITLE, { Status: "Todo" });
    withTask(data, "Short one", { Status: "Todo" });
    withList(data, "Everything");
    await renderWithBoard(<BoardShell initialTask={null} />, data, serving(data));

    const long = card(LONG_TITLE.slice(0, 40)).getByTestId("card-title");
    await expect.element(long).toBeVisible();
    expect(linesOf(long)).toBe(3);
    // The words past the third line are cut, not gone.
    expect(html(long).scrollHeight).toBeGreaterThan(html(long).clientHeight);
    await expect.element(long).toHaveAttribute("title", LONG_TITLE);

    // A title that fits still says itself on hover.
    const short = card("Short one").getByTestId("card-title");
    expect(linesOf(short)).toBe(1);
    await expect.element(short).toHaveAttribute("title", "Short one");

    await byTestId("view-pill").filter({ hasText: "Everything" }).click();
    await expect
      .element(listRow(LONG_TITLE.slice(0, 40)).getByTestId("list-row-title"))
      .toHaveAttribute("title", LONG_TITLE);
    await expect
      .element(listRow("Short one").getByTestId("list-row-title"))
      .toHaveAttribute("title", "Short one");
  });
});

/*
 * A description is read far more often than it is edited. The editor wraps a
 * long line, so the rendered text has to wrap it too: a sideways scroll hides
 * the end of the line, and nothing on screen says there is more. The spec
 * typed the words in and posted the comment; the typing is the panel's own
 * test, and what is measured here is how the words lie.
 */

const PATH = `src/app/api/projects/[projectId]/{agents,members,invites,webhooks,import}/${"x".repeat(60)}`;
const URL = `https://example.com/${"a-very-long-segment-".repeat(6)}end`;
const LONG_LINE = `const everything = [${Array.from({ length: 30 }, (_, i) => `"item${i}"`).join(", ")}];`;

const TEXT = `Look at \`${PATH}\` first.\n\nThen ${URL}\n\n\`\`\`\n${LONG_LINE}\n\`\`\``;

/** Every element inside `box` fits its own width, and the box fits its parent. */
function nothingScrollsSideways(box: Locator) {
  const root = html(box);
  const wide = [root, ...Array.from(root.querySelectorAll("*"))]
    .filter((el) => el.scrollWidth > el.clientWidth && el.clientWidth > 0)
    .map((el) => `${el.tagName} ${el.scrollWidth}>${el.clientWidth}`);
  expect(wide).toEqual([]);
  expect(root.getBoundingClientRect().right).toBeLessThanOrEqual(
    root.parentElement!.getBoundingClientRect().right + 0.5,
  );
}

const WIDTHS = [
  { name: "on a desk", width: 1280, height: 800 },
  { name: "on a phone", width: 390, height: 780 },
];

for (const { name, width, height } of WIDTHS) {
  describe(`A long line in markdown ${name}`, () => {
    test("wraps in a description and a comment", async () => {
      await page.viewport(width, height);
      const data = newProject();
      const task: TaskDTO = withTask(data, "Long lines", { Status: "Todo" });
      task.description = TEXT;
      const comment: CommentDTO = {
        id: "00000000-0000-4000-8000-666666666666",
        body: TEXT,
        createdAt: "2026-10-08T09:30:00.000Z",
        editedAt: null,
        byProject: false,
        author: { id: ME.id, name: ME.name, color: ME.color, emoji: null, kind: "human" },
      };
      await renderWithBoard(<BoardShell initialTask={task.key} />, data, serving(data, [comment]));
      await expect.element(byTestId("task-panel")).toBeVisible();

      const description = byTestId("markdown");
      await expect.element(description).toBeVisible();
      expect(html(description).querySelector("pre code")!.textContent).toContain('"item29"');
      expect(html(description).querySelector("p code")!.textContent).toContain("webhooks,import");
      nothingScrollsSideways(description);
      // The block is taller than one line, because the line wrapped.
      expect(
        html(description).querySelector("pre")!.getBoundingClientRect().height,
      ).toBeGreaterThan(50);

      const said = byTestId("comment-markdown");
      await expect.element(said).toBeVisible();
      expect(html(said).querySelector("a")!.textContent).toContain("example.com");
      nothingScrollsSideways(said);
    });
  });
}

const FIVE_LINES = [
  "Move the invoices",
  "to the new bucket",
  "and tell accounting",
  "before the end of the month",
  "so nothing is paid twice",
].join("\n");

/** The height the box draws, and whether it hides any of its text. */
function boxOf(input: Locator) {
  const el = html(input);
  return { height: el.clientHeight, scrolls: el.scrollHeight > el.clientHeight };
}

/** Grows with five lines, shows every one, and shrinks back when they go. */
async function grows(input: Locator) {
  await expect.poll(() => boxOf(input)).toEqual({ height: 42, scrolls: false });

  await input.fill(FIVE_LINES);
  await expect.poll(() => boxOf(input).scrolls).toBe(false);
  // Five lines of 12.5px at a line height of 1.4.
  expect(boxOf(input).height).toBeGreaterThanOrEqual(5 * 17);

  await input.fill("Short again");
  await expect.poll(() => boxOf(input)).toEqual({ height: 42, scrolls: false });
}

describe("The new-task composer", () => {
  test("grows with a long title in a column, and the @ list opens under it", async () => {
    const data = newProject();
    await renderWithBoard(<BoardShell initialTask={null} />, data, serving(data));

    await page.getByRole("button", { name: "Add a task to Todo" }).first().click();
    const input = page.getByPlaceholder("What needs doing?");
    await grows(input);

    // The list hangs from the whole composer, so a tall box never covers it.
    await input.fill(FIVE_LINES);
    await userEvent.type(input, " @");
    const list = byTestId("mention-list");
    await expect.element(list).toBeVisible();
    const under = html(list).getBoundingClientRect();
    const typed = html(input).getBoundingClientRect();
    expect(under.y).toBeGreaterThanOrEqual(typed.y + typed.height);
  });

  test("grows the same way at the end of a list", async () => {
    const data = newProject();
    withTask(data, "One row", { Status: "Todo" });
    withList(data, "Rows");
    await renderWithBoard(<BoardShell initialTask={null} />, data, serving(data));
    await byTestId("view-pill").filter({ hasText: "Rows" }).click();

    await byTestId("list-add").click();
    const input = page.getByPlaceholder("What needs doing?");
    await expect.element(input).toHaveFocus();
    await grows(input);
  });
});
