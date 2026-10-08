import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import type { AgentRunDTO, BoardData, FilterRule } from "@/lib/types";
import {
  detailOf,
  minutesAgo,
  newProject,
  optionOf,
  propertyOf,
  renderWithBoard,
  withAgent,
  withRun,
  withTask,
  type Answer,
} from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * "N waiting" in the top bar and the list behind it. Each test here was a test
 * of `e2e/waiting.spec.ts`, whole, and keeps its name. The one that answers
 * from the list and watches the count fall live stayed there.
 */

const TASK = /^\/api\/tasks\/([0-9a-f-]+)$/;

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const rows = byTestId("waiting-row");
const count = byTestId("waiting-count");

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/**
 * The e2e `askTwice`: Asker asked two questions, the older one two hours ago
 * and in Backlog, one run handed its task over and one works. With `third`,
 * a third question, the newest.
 */
function askTwice(third = false) {
  const data = newProject();
  const asker = withAgent(data, "Asker");
  const task = (title: string, status = "Todo") => withTask(data, title, { Status: status });
  const older = withRun(data, task("Older question", "Backlog"), asker, {
    goal: "Older question",
    status: "waiting",
    step: "Which queue?",
    updatedAt: minutesAgo(120),
  });
  const newer = withRun(data, task("Newer question"), asker, {
    goal: "Newer question",
    status: "waiting",
    step: "Which region?",
    updatedAt: minutesAgo(1),
  });
  withRun(data, task("Hands it over"), asker, {
    goal: "Hands it over",
    status: "handed_over",
    step: "review",
  });
  withRun(data, task("Just works"), asker, { goal: "Just works" });
  if (third) {
    withRun(data, task("Newest question"), asker, {
      goal: "Newest question",
      status: "waiting",
      step: "Which colour?",
    });
  }
  return { data, older, newer };
}

/** Every task reads as itself, with its open run, so a pick opens to be answered. */
function details(data: BoardData): Answer {
  return ({ method, path }) => {
    const id = method === "GET" ? TASK.exec(path)?.[1] : undefined;
    const task = data.tasks.find((t) => t.id === id);
    if (!task) return;
    const run = data.runs.find((r) => r.taskId === task.id) ?? null;
    return {
      body: {
        task: detailOf(task, { run: run && { ...run, steps: [], log: [], logMore: false } }),
      },
    };
  };
}

/** The e2e `pastTheBar`: how far anything in the top bar reaches past its padding. */
function pastTheBar(): number {
  const bar = byTestId("top-bar").element();
  const style = getComputedStyle(bar);
  const box = bar.getBoundingClientRect();
  const left = box.left + parseFloat(style.paddingLeft);
  const right = box.right - parseFloat(style.paddingRight);
  let past = 0;
  for (const el of bar.querySelectorAll("*")) {
    const at = el.getBoundingClientRect();
    if (at.width <= 0) continue;
    past = Math.max(past, at.right - right, left - at.left);
  }
  return Math.max(Math.round(past), 0);
}

/** The e2e `overflow`: how far the page scrolls sideways. */
function overflow(): number {
  const doc = document.documentElement;
  return Math.max(doc.scrollWidth - doc.clientWidth, 0);
}

function statusIs(data: BoardData, name: string): FilterRule {
  return {
    propertyId: propertyOf(data, "Status").id,
    op: "is",
    values: [optionOf(data, "Status", name)],
  };
}

describe("The questions that wait on a person", () => {
  test("hide from no view rule, folded column or list", async () => {
    const { data } = askTwice();
    /* A rule on the view, for everybody, hides the older one. Saving a rule
       for everyone is the filter tests'; here it is on the view already. */
    data.views[0].filters = { rules: [statusIs(data, "Todo")] };
    /* A list is the same tasks lying down. The e2e test made it from the
       strip; here it is on the project already. */
    data.views.push({
      ...data.views[0],
      id: "00000000-0000-4000-8000-444444444444",
      name: "Rows",
      kind: "list",
      position: "z0000000",
      isDefault: false,
      filters: { rules: [] },
    });
    await renderWithBoard(<BoardShell initialTask={null} />, data, details(data));

    await expect.element(count).toHaveTextContent("2 waiting");
    await expect.element(card("Newer question")).toBeVisible();
    await gone(card("Older question"));

    // Folding the column hides the newer one as well.
    await page.getByRole("button", { name: "Fold the column Todo" }).click();
    await gone(card("Newer question"));
    await expect.element(count).toHaveTextContent("2 waiting");

    // A list counts the same.
    await byTestId("view-pill").filter({ hasText: "Rows" }).click();
    await expect.element(byTestId("list-view")).toBeVisible();
    await expect.element(count).toHaveTextContent("2 waiting");
    await count.click();
    await expect.poll(() => rows.elements().length).toBe(2);
  });

  test("keep the highlight on its task when another row goes", async () => {
    const { data, older } = askTwice(true);
    const { ring } = await renderWithBoard(<BoardShell initialTask={null} />, data, details(data));

    try {
      await expect.element(count).toHaveTextContent("3 waiting");
      await count.click();
      await expect.poll(() => rows.elements().length).toBe(3);
      await userEvent.keyboard("{ArrowDown}");
      await expect.element(rows.nth(1)).toMatchTextContent("Newer question");
      await expect.element(rows.nth(1)).toHaveAttribute("aria-selected", "true");

      // The row above goes. The highlight stays on the question it was on.
      Object.assign(older, {
        status: "running",
        step: "Reading the answer",
        updatedAt: minutesAgo(0),
      } satisfies Partial<AgentRunDTO>);
      ring();
      await expect.poll(() => rows.elements().length).toBe(2);
      await expect.element(rows.nth(0)).toMatchTextContent("Newer question");
      await expect.element(rows.nth(0)).toHaveAttribute("aria-selected", "true");
      await userEvent.keyboard("{Enter}");

      const newer = data.tasks.find((t) => t.title === "Newer question")!;
      await expect.poll(() => window.location.search).toMatch(new RegExp(`task=${newer.key}$`));
      await expect.element(byTestId("comment-box")).toHaveFocus();
    } finally {
      leaveTask();
    }
  });

  test("fit on a phone", async () => {
    await page.viewport(390, 820);
    try {
      const { data } = askTwice();
      await renderWithBoard(<BoardShell initialTask={null} />, data, details(data));

      await expect.element(count).toHaveTextContent("2 waiting");
      expect(pastTheBar()).toBe(0);

      await count.click();
      const list = byTestId("waiting-list");
      await expect.element(list).toBeVisible();
      const at = list.element().getBoundingClientRect();
      expect(at.left).toBeGreaterThanOrEqual(0);
      expect(at.right).toBeLessThanOrEqual(390);
      expect(overflow()).toBe(0);

      await rows.first().click();
      await expect.element(byTestId("comment-box")).toHaveFocus();
    } finally {
      leaveTask();
      await page.viewport(1440, 900);
    }
  });
});

/* Opening a task writes its key into the address, and the next test's page
   must not start with one. */
function leaveTask() {
  const url = new URL(window.location.href);
  url.searchParams.delete("task");
  window.history.replaceState(null, "", url.toString());
}
