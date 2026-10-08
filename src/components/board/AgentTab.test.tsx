import { describe, expect, test } from "vitest";
import { page, type Locator } from "vitest/browser";
import type {
  AgentRunDetailDTO,
  AgentRunDTO,
  AgentRunLogDTO,
  AgentRunRowDTO,
  AgentRunStepDTO,
  BoardData,
  MemberDTO,
  TaskDTO,
  TaskDetailDTO,
} from "@/lib/types";
import {
  detailOf,
  minutesAgo,
  newProject,
  renderWithBoard,
  runOn,
  withAgent,
  withRun,
  withTask,
  type Answer,
} from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * The Agent tab of the task panel: the open run, the runs that are over, and
 * what the panel offers while a run waits. Each test here was the screen half
 * of an end to end test, and names it. Who may call a route, what a run keeps
 * and the lease are route tests; here the answers are the fake's, and a test
 * says what the panel drew from them and what a press sent.
 */

const TASK = /^\/api\/tasks\/([0-9a-f-]+)$/;
const RUN = /^\/api\/runs\/([0-9a-f-]+)$/;

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/** A log in the order it was written, oldest first. */
function logOf(texts: string[], from = 0): AgentRunLogDTO[] {
  return texts.map((text, i) => ({
    id: `log-${String(from + i).padStart(4, "0")}`,
    text,
    createdAt: minutesAgo(60),
  }));
}

/** A plan, with every step before `at` done. */
function planOf(texts: string[], at: number): AgentRunStepDTO[] {
  return texts.map((text, index) => ({
    id: `step-${index}`,
    text,
    index,
    state: index < at ? "done" : index === at ? "active" : "todo",
  }));
}

/** What an agent says moves its run on, and is its last report. */
function report(run: AgentRunDTO, fields: Partial<AgentRunDTO>) {
  Object.assign(run, { ...fields, updatedAt: minutesAgo(0) });
}

/** A run that is over, as a row of the history carries it. */
function over(run: AgentRunDTO): AgentRunRowDTO {
  return { ...run, status: "done", endedAt: minutesAgo(1) };
}

/**
 * The server, as far as the panel reads it: one task, its open run if it has
 * one, the runs that are over, and every run's plan and log. A log answers
 * its tail of forty and the pages of a hundred before a line, newest first,
 * as `GET /api/runs/{id}` does.
 */
type Fake = {
  task: TaskDTO;
  open: AgentRunDTO | null;
  past: AgentRunRowDTO[];
  more?: Partial<TaskDetailDTO>;
  plans: Record<string, AgentRunStepDTO[]>;
  logs: Record<string, AgentRunLogDTO[]>;
};

function fullRun(fake: Fake, run: AgentRunRowDTO | AgentRunDTO): AgentRunDetailDTO {
  const log = fake.logs[run.id] ?? [];
  const steps = fake.plans[run.id] ?? [];
  return {
    ...run,
    stepsTotal: steps.length,
    stepsDone: steps.filter((s) => s.state === "done").length,
    lastLog: log.at(-1)?.text ?? null,
    steps,
    log: log.slice(-40),
    logMore: log.length > 40,
  };
}

function serve(fake: Fake): Answer {
  return ({ method, path, query }) => {
    if (method !== "GET") return;
    if (TASK.exec(path)?.[1] === fake.task.id) {
      const detail = detailOf(fake.task, {
        run: fake.open && fullRun(fake, fake.open),
        pastRuns: fake.past.slice(0, 20),
        pastRunsTotal: fake.past.length,
        ...fake.more,
      });
      return { body: { task: detail } };
    }
    const runId = RUN.exec(path)?.[1];
    const run = runId && [fake.open, ...fake.past].find((r) => r?.id === runId);
    if (!run) return;
    const before = query.get("before");
    if (!before) return { body: { run: fullRun(fake, run) } };
    const log = fake.logs[run.id] ?? [];
    const at = log.findIndex((line) => line.id === before);
    const from = Math.max(0, at - 100);
    return { body: { lines: log.slice(from, at).reverse(), more: from > 0 } };
  };
}

function draw(data: BoardData, answer: Answer, initialTask: string | null = null) {
  return renderWithBoard(<BoardShell initialTask={initialTask} />, data, answer);
}

function agentIn(data: BoardData, name: string): MemberDTO {
  return withAgent(data, name);
}

describe("The Agent tab", () => {
  /* Was e2e/agents.spec.ts, the panel half. What an agent reads off the task
     is a route test. */
  test("a run that is over can still be read on the task", async () => {
    const data = newProject();
    const task = withTask(data, "Worked on yesterday", { Status: "Todo" });
    const run = over(runOn(task, agentIn(data, "Historian"), { goal: "Write the queue tests" }));
    await draw(
      data,
      serve({
        task,
        open: null,
        past: [run],
        plans: { [run.id]: planOf(["Read the queue module", "Write the tests"], 2) },
        logs: {
          [run.id]: logOf([
            "started: Write the queue tests",
            "wrote tests/queue.spec.ts",
            "opened PR #124",
          ]),
        },
      }),
    );

    // The card says nothing, and the tab holds the record.
    await expect.element(card("Worked on yesterday")).toBeVisible();
    await gone(card("Worked on yesterday").getByTestId("card-run"));

    await card("Worked on yesterday").click();
    const tab = byTestId("agent-tab");
    await expect.element(tab).toBeVisible();
    // No count beside the word, and nothing pulsing: nobody is working.
    await expect.element(tab).toHaveTextContent("Agent");
    await tab.click();

    await gone(byTestId("panel-run"));
    const row = byTestId("past-run").first();
    await expect.element(row).toMatchTextContent("Historian");
    await expect.element(row).toMatchTextContent("finished");
    await expect.element(row).toMatchTextContent("Write the queue tests");

    // Pressing it opens the plan and the log as they were left.
    await gone(byTestId("past-run-open"));
    await row.click();
    const opened = byTestId("past-run-open");
    await expect.element(opened).toMatchTextContent("Read the queue module");
    await expect.element(opened.getByText("opened PR #124")).toBeVisible();
    await expect.element(opened.getByText("wrote tests/queue.spec.ts")).toBeVisible();

    // One row open at a time, and pressing it again closes it.
    await row.click();
    await gone(byTestId("past-run-open"));
  });

  /* Was e2e/agents.spec.ts "a removed agent leaves its runs on the task". The
     question in Settings and the token that stops working are checked
     elsewhere; this is what stays on the task. */
  test("a removed agent leaves its runs on the task", async () => {
    const data = newProject();
    const task = withTask(data, "Worked on before removal", { Status: "Todo" });
    // Not a member any more. The run still carries the name it was made with.
    const departed = { id: "00000000-0000-4000-8000-777777777777", name: "Departed" };
    const run = over(
      runOn(task, { ...departed, color: "#8b6cd9", emoji: null }, { goal: "Leave a record" }),
    );
    await draw(
      data,
      serve({
        task,
        open: null,
        past: [run],
        plans: { [run.id]: planOf(["Plan the work", "Do the work"], 0) },
        logs: { [run.id]: logOf(["left a line in the log"]) },
      }),
    );
    expect(data.members.some((m) => m.name === "Departed")).toBe(false);

    await card("Worked on before removal").click();
    await byTestId("agent-tab").click();
    const row = byTestId("past-run").first();
    await expect.element(row).toMatchTextContent("Departed");
    await expect.element(row).toMatchTextContent("Leave a record");
    await row.click();
    const opened = byTestId("past-run-open");
    await expect.element(opened).toMatchTextContent("Plan the work");
    await expect.element(opened.getByText("left a line in the log")).toBeVisible();
  });

  /* Was e2e/agents.spec.ts, whole. A report elsewhere is the fake moving the
     run on and ringing the stream. */
  test("a task opens on the Agent tab while an agent works on it", async () => {
    const data = newProject();
    const task = withTask(data, "Being worked on", { Status: "Todo" });
    const run = withRun(data, task, agentIn(data, "Worker"), { step: "Reading" });
    const fake: Fake = { task, open: run, past: [], plans: {}, logs: {} };
    const { ring } = await draw(data, serve(fake));

    const held = card("Being worked on");
    const close = page.getByRole("button", { name: "Close task" });

    // A running run opens on the work.
    await held.click();
    await expect.element(byTestId("panel-run")).toBeVisible();
    await gone(byTestId("comment-box"));

    // A tab the person picks holds through a board read.
    await page.getByRole("tab", { name: /^Comments/ }).click();
    await expect.element(byTestId("comment-box")).toBeVisible();
    report(run, { step: "Writing", lastLog: "moved on" });
    ring();
    await expect.element(held.getByTestId("card-run-step")).toHaveTextContent("Writing");
    await expect.element(byTestId("comment-box")).toBeVisible();
    await gone(byTestId("panel-run"));
    await close.click();

    // A paused run still opens on the work.
    report(run, { status: "paused" });
    ring();
    await expect.element(held.getByTestId("card-run-step")).toHaveTextContent("Writing");
    await held.click();
    await expect.element(byTestId("panel-run")).toMatchTextContent("paused");
    await close.click();

    // A run that asks opens on the question.
    report(run, { status: "waiting", step: "Which queue?" });
    ring();
    await expect.element(held.getByTestId("card-run-step")).toHaveTextContent("Which queue?");
    await held.click();
    await expect.element(byTestId("comment-box")).toBeVisible();
    await gone(byTestId("panel-run"));
    await expect.element(byTestId("agent-tab")).toBeVisible();
  });

  /* Was e2e/listening.spec.ts, the screen half. The feed that carries the
     answer and the lease that leaves a waiting run alone are route tests. */
  test("a waiting run shows its question, keeps its card, and hears the answer", async () => {
    const data = newProject();
    const task = withTask(data, "Make the queue retry", { Status: "Todo" });
    const asker = agentIn(data, "Asker");
    const run = withRun(data, task, asker, {
      goal: "Refine it",
      status: "waiting",
      step: "Which service owns the queue?",
    });
    const asked = {
      id: "00000000-0000-4000-8000-666666666666",
      body: "Which service owns the queue?",
      createdAt: minutesAgo(5),
      editedAt: null,
      byProject: false,
      author: { ...asker, kind: "agent" as const },
    };
    const { sent } = await draw(
      data,
      serve({ task, open: run, past: [], more: { comments: [asked] }, plans: {}, logs: {} }),
    );

    const held = card("Make the queue retry");
    await expect
      .element(held.getByTestId("card-run-step"))
      .toHaveTextContent("Which service owns the queue?");
    await expect.element(held.getByTestId("card-run-time")).toMatchTextContent("waiting");

    // The panel says how to answer, and offers nothing nobody would read.
    await held.click();
    await byTestId("agent-tab").click();
    const panel = byTestId("panel-run");
    await expect
      .element(byTestId("panel-run-waiting"))
      .toMatchTextContent("Answer it in a comment");
    await gone(panel.getByRole("button", { name: "Pause" }));
    await gone(panel.getByRole("button", { name: "Stop" }));
    await expect.element(panel.getByRole("button", { name: "Take over" })).toBeVisible();

    await page.getByRole("tab", { name: /^Comments/ }).click();
    const composer = page.getByPlaceholder("Answer Asker…");
    await composer.fill("The billing service.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();

    const comments = new RegExp(`^/api/tasks/${task.id}/comments$`);
    await expect.poll(() => sent("POST", comments).length).toBe(1);
    expect(sent("POST", comments)[0].body).toEqual({ body: "The billing service." });
  });

  /* Was e2e/listening.spec.ts, the screen half. The refused hand-overs, the
     lease and the next claim are route tests. */
  test("a run hands the task on, and the next claim closes it", async () => {
    const data = newProject();
    const task = withTask(data, "Make the queue retry", { Status: "Todo" });
    const run = withRun(data, task, agentIn(data, "Builder"), {
      goal: "Open the pull request",
      status: "handed_over",
      step: "review",
    });
    const fake: Fake = { task, open: run, past: [], plans: {}, logs: {} };
    const control = new RegExp(`^/api/runs/${run.id}/control$`);
    const answer = serve(fake);
    const { sent } = await draw(data, (req) => {
      // Take over ends the run: the board and the task read it as over.
      if (req.method === "POST" && control.test(req.path)) {
        data.runs = [];
        fake.past = [{ ...run, status: "taken_over", endedAt: minutesAgo(0) }];
        fake.open = null;
        return;
      }
      return answer(req);
    });

    // The card says who has it, instead of going quiet.
    const held = card("Make the queue retry");
    await expect.element(held.getByTestId("card-run-step")).toHaveTextContent("Waiting for review");
    await expect.element(held.getByTestId("card-run-time")).toMatchTextContent("waiting");

    await held.click();
    await byTestId("agent-tab").click();
    const panel = byTestId("panel-run");
    await expect
      .element(byTestId("panel-run-handed-over"))
      .toMatchTextContent("Builder handed the task to review");
    await gone(panel.getByRole("button", { name: "Pause" }));
    await gone(panel.getByRole("button", { name: "Stop" }));

    // Take over still ends it, as it ends any open run.
    await panel.getByRole("button", { name: "Take over" }).click();
    await expect.poll(() => sent("POST", control).length).toBe(1);
    expect(sent("POST", control)[0].body).toEqual({ control: "take_over" });
    await gone(byTestId("panel-run"));
    await gone(held.getByTestId("card-run"));
  });

  /* Was e2e/listening.spec.ts, whole. */
  test("a comment stays a comment, and offers no way to become the description", async () => {
    const data = newProject();
    const task = withTask(data, "Offline queue", { Status: "Todo" });
    const drafter = agentIn(data, "Drafter");
    const said = {
      id: "00000000-0000-4000-8000-555555555555",
      body: "Queue writes offline.",
      createdAt: minutesAgo(5),
      editedAt: null,
      byProject: false,
      author: { ...drafter, kind: "agent" as const },
    };
    await draw(
      data,
      serve({ task, open: null, past: [], more: { comments: [said] }, plans: {}, logs: {} }),
      task.key,
    );

    const comment = byTestId("comment").filter({ hasText: "Queue writes offline." });
    await comment.hover();
    await expect.element(comment).toBeVisible();
    await gone(comment.getByRole("button", { name: "Use as description" }));
  });

  /* The panel's half of e2e/listening.spec.ts "a value line names its type
     and its person, and the panel names the person". The line stores the id,
     and the panel says the name. The line itself is activity-route.test.ts. */
  test("a value line names its type and its person, and the panel names the person", async () => {
    const data = newProject();
    const task = withTask(data, "Hand it over", { Status: "Todo" });
    const reis = agentIn(data, "Reis");
    const line = {
      id: "00000000-0000-4000-8000-666666666666",
      kind: "value",
      createdAt: minutesAgo(1),
      data: { property: "Assignee", type: "person", value: reis.id, personId: reis.id },
      actor: {
        id: data.members[0].id,
        name: "Line Owner",
        color: "#4b8fbe",
        emoji: null,
        kind: "human" as const,
      },
    };
    await draw(
      data,
      serve({ task, open: null, past: [], more: { activity: [line] }, plans: {}, logs: {} }),
      task.key,
    );

    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect.element(page.getByText("Line Owner set Assignee to Reis")).toBeVisible();
    await gone(page.getByText(reis.id));
  });
});

/* Was e2e/run-history.spec.ts. Its paging through the API, the cursors that
   are refused and the runs written straight into the database are route
   tests; these are the pages the panel draws. */
describe("Reading every line and every run", () => {
  test("a 300-line log reads from its first line, and a new line keeps the old ones", async () => {
    const data = newProject();
    const task = withTask(data, "A long log", { Status: "Todo" });
    const run = withRun(data, task, agentIn(data, "Scribe"), { goal: "Write a lot" });
    const log = logOf(
      Array.from({ length: 300 }, (_, i) => `line ${String(i + 1).padStart(3, "0")}`),
    );
    const fake: Fake = { task, open: run, past: [], plans: {}, logs: { [run.id]: log } };
    const { ring } = await draw(data, serve(fake));

    // The panel: press until the first line is there.
    await card("A long log").click();
    const panelLog = byTestId("panel-run").getByTestId("panel-run-log");
    const lines = panelLog.getByTestId("run-log-line");
    const count = () => lines.elements().length;
    const texts = () => lines.elements().map((el) => el.lastElementChild?.textContent);
    await expect.poll(count).toBe(40);
    const earlier = panelLog.getByTestId("run-log-earlier");
    for (const n of [140, 240, 300]) {
      await earlier.click();
      await expect.poll(count).toBe(n);
    }
    await gone(earlier);
    await expect.element(lines.first()).toMatchTextContent("line 001");
    expect(new Set(texts()).size).toBe(300);

    // The run writes on, and the earlier lines stay.
    log.push(...logOf(["one more line"], 300));
    ring();
    await expect.poll(count).toBe(301);
    await expect.element(lines.last()).toMatchTextContent("one more line");
    await expect.element(lines.first()).toMatchTextContent("line 001");

    // More than a tail's worth at once: the panel reads across the gap.
    const burst = Array.from({ length: 60 }, (_, i) => `burst ${String(i + 1).padStart(2, "0")}`);
    log.push(...logOf([...burst, "after the burst"], 301));
    ring();
    await expect.poll(count).toBe(362);
    await expect.element(lines.last()).toMatchTextContent("after the burst");
    await expect.element(lines.first()).toMatchTextContent("line 001");
    expect(new Set(texts()).size).toBe(362);

    // The same run, over, opened from Earlier runs.
    log.push(...logOf(["finished"], 362));
    data.runs = [];
    fake.past = [over(run)];
    fake.open = null;
    ring();
    await gone(byTestId("panel-run"));
    await byTestId("past-run").first().click();
    const pastLog = byTestId("past-run-open").getByTestId("panel-run-log");
    const pastLines = pastLog.getByTestId("run-log-line");
    const pastCount = () => pastLines.elements().length;
    await expect.poll(pastCount).toBe(40);
    for (const n of [140, 240, 340, 363]) {
      await pastLog.getByTestId("run-log-earlier").click();
      await expect.poll(pastCount).toBe(n);
    }
    await gone(pastLog.getByTestId("run-log-earlier"));
    await expect.element(pastLines.first()).toMatchTextContent("line 001");
  });

  test("a task with 40 runs says so and shows them all", async () => {
    const data = newProject();
    const task = withTask(data, "Run many times", { Status: "Todo" });
    const scribe = agentIn(data, "Scribe");
    // Newest first, as the history reads.
    const past = Array.from({ length: 40 }, (_, i) =>
      over(runOn(task, scribe, { goal: `goal ${String(40 - i).padStart(2, "0")}` })),
    );
    const answer = serve({ task, open: null, past, plans: {}, logs: {} });
    const runs = new RegExp(`^/api/tasks/${task.id}/runs$`);
    const { sent } = await draw(data, (req) => {
      if (req.method === "GET" && runs.test(req.path)) {
        const at = past.findIndex((r) => r.id === req.query.get("before"));
        return { body: { runs: past.slice(at + 1, at + 21), more: at + 21 < past.length } };
      }
      return answer(req);
    });

    await card("Run many times").click();
    await byTestId("agent-tab").click();
    await expect.element(byTestId("past-runs-total")).toHaveTextContent("Earlier runs · 40");
    const rows = byTestId("past-run");
    await expect.poll(() => rows.elements().length).toBe(20);
    await byTestId("past-runs-more").click();
    await expect.poll(() => rows.elements().length).toBe(40);
    await gone(byTestId("past-runs-more"));

    // The page was asked for after the last row it had.
    expect(sent("GET", runs).map((r) => r.query.get("before"))).toEqual([past[19].id]);
    const goals = rows.elements().map((el) => el.textContent?.match(/goal \d\d/)?.[0]);
    expect(new Set(goals).size).toBe(40);
  });
});
