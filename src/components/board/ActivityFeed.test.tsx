import { describe, expect, test } from "vitest";
import { page, type Locator } from "vitest/browser";
import type { ActivityDTO, MemberDTO, TaskDTO } from "@/lib/types";
import {
  detailOf,
  minutesAgo,
  newProject,
  renderWithBoard,
  withAgent,
  withPerson,
  withTask,
  type Answer,
} from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * USH-469: the Activity tab of the task panel. A face on every line, a
 * choice of whose lines to read, and the older lines on a press. Who may
 * call the route and how it pages are in `task-activity-route.test.ts`.
 */

const TASK = /^\/api\/tasks\/([0-9a-f-]+)$/;
const OLDER = /^\/api\/tasks\/([0-9a-f-]+)\/activity$/;

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const lines = () => byTestId("activity-line");
const count = () => lines().elements().length;

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

let made = 0;
/** A line by `who`, or by nobody, saying "<who> created the task" or a note. */
function line(who: MemberDTO | null, n: number): ActivityDTO {
  made += 1;
  return {
    id: `00000000-0000-4000-9100-${String(made).padStart(12, "0")}`,
    kind: "comment",
    data: { n },
    createdAt: minutesAgo(n),
    via: null,
    actor: who && {
      id: who.id,
      name: who.name,
      color: who.color,
      emoji: who.emoji,
      kind: who.kind,
    },
  };
}

/** The task read sends the newest sixty, the route the sixty before a line. */
function serve(task: TaskDTO, all: () => ActivityDTO[]): Answer {
  return ({ method, path, query }) => {
    if (method !== "GET") return;
    if (TASK.exec(path)?.[1] === task.id) {
      const list = all();
      return {
        body: {
          task: detailOf(task, { activity: list.slice(0, 60), activityMore: list.length > 60 }),
        },
      };
    }
    if (OLDER.exec(path)?.[1] === task.id) {
      const list = all();
      const at = list.findIndex((l) => l.id === query.get("before"));
      const page = list.slice(at + 1, at + 61);
      return { body: { activity: page, more: at + 61 < list.length } };
    }
  };
}

describe("The Activity tab", () => {
  test("each line wears its actor's face, and the buttons narrow to people or agents", async () => {
    const data = newProject();
    const task = withTask(data, "Faces", { Status: "Todo" });
    const mira = withPerson(data, "Mira");
    const reis = withAgent(data, "Reis");
    const all = [line(reis, 1), line(mira, 2), line(null, 3)];
    await renderWithBoard(
      <BoardShell initialTask={null} />,
      data,
      serve(task, () => all),
    );

    await card("Faces").click();
    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect.poll(count).toBe(3);

    // The agent's face is the agent's, the person's the person's, and nobody's an empty slot.
    const [agentLine, personLine, nobody] = lines().elements();
    expect(agentLine.textContent).toContain("Reis");
    expect(agentLine.querySelector("[title='Reis']")?.textContent).toContain("◆");
    expect(personLine.querySelector("[title='Mira']")?.textContent).toBe("MI");
    expect(nobody.querySelector("[title]")).toBeNull();
    const edge = (el: Element) =>
      (el.querySelector("[class*=activityText]") as HTMLElement).getBoundingClientRect().left;
    expect(edge(nobody)).toBe(edge(agentLine));
    expect(edge(personLine)).toBe(edge(agentLine));

    const group = page.getByRole("group", { name: "Whose activity" });
    const everyone = group.getByRole("button", { name: "Everyone" });
    await expect.element(everyone).toHaveAttribute("aria-pressed", "true");

    await group.getByRole("button", { name: "Agents" }).click();
    await expect.poll(count).toBe(1);
    expect(lines().elements()[0].textContent).toContain("Reis");

    await group.getByRole("button", { name: "People" }).click();
    await expect.poll(count).toBe(1);
    expect(lines().elements()[0].textContent).toContain("Mira");
    await expect
      .element(group.getByRole("button", { name: "People" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(everyone).toHaveAttribute("aria-pressed", "false");

    await everyone.click();
    await expect.poll(count).toBe(3);
  });

  test("a choice that leaves no line says so and still offers older lines", async () => {
    const data = newProject();
    const task = withTask(data, "Only people", { Status: "Todo" });
    const mira = withPerson(data, "Mira");
    const all = Array.from({ length: 61 }, (_, i) => line(mira, i));
    await renderWithBoard(
      <BoardShell initialTask={null} />,
      data,
      serve(task, () => all),
    );

    await card("Only people").click();
    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect.poll(count).toBe(60);
    await page.getByRole("button", { name: "Agents" }).click();
    await expect.element(page.getByText("No agent wrote any of these lines.")).toBeVisible();
    await expect.element(byTestId("activity-older")).toBeVisible();
  });

  test("a task with no lines says so and draws no buttons", async () => {
    const data = newProject();
    const task = withTask(data, "Quiet", { Status: "Todo" });
    await renderWithBoard(
      <BoardShell initialTask={null} />,
      data,
      serve(task, () => []),
    );
    await card("Quiet").click();
    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect.element(page.getByText("No activity yet.")).toBeVisible();
    await gone(page.getByRole("button", { name: "Everyone" }));
  });

  test("a task with 61 lines offers Show older, and the lines stay through a reload", async () => {
    const data = newProject();
    const task = withTask(data, "Long history", { Status: "Todo" });
    const mira = withPerson(data, "Mira");
    let all = Array.from({ length: 61 }, (_, i) => line(mira, i + 1));
    const { ring } = await renderWithBoard(
      <BoardShell initialTask={null} />,
      data,
      serve(task, () => all),
    );

    await card("Long history").click();
    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect.poll(count).toBe(60);
    await byTestId("activity-older").click();
    await expect.poll(count).toBe(61);
    expect(lines().elements()[60].querySelector("[title='Mira']")).not.toBeNull();
    await gone(byTestId("activity-older"));

    // A write elsewhere adds a line; the reload sends the newest sixty again.
    all = [line(mira, 0), ...all];
    ring(task.id);
    await expect.poll(count).toBe(62);
    await gone(byTestId("activity-older"));
  });
});
