import { expect, test, type Page } from "@playwright/test";
import { addTask, createProject, inDatabase, letterTo, register, unique } from "./helpers";
import { smtpReceiver } from "../src/lib/__tests__/smtp";

/**
 * A question an agent asked, and nobody answered, is emailed once.
 *
 * Mail is set by the server's environment, so which half of this file runs
 * depends on the server: the one Playwright starts on CI has mail, the dev
 * server in Docker has none. The delay is fifteen minutes and a test cannot
 * wait that long, so it moves the moment the run began to wait instead.
 */
const smtpPort = Number(process.env.USHABTI_TEST_SMTP_PORT) || 0;

/** A project with an agent in it, and a task with a waiting run that agent asked. */
async function anAsk(page: Page) {
  const account = await register(page, "Ask Owner");
  const projectId = await createProject(page, unique("Asks"));
  await addTask(page, "Todo", "Pick a queue");
  await page.getByRole("button", { name: "Close task" }).click();

  const as = page.request;
  const made = await as.post(`/api/projects/${projectId}/agents`, { data: { name: "Reis" } });
  const agentId = ((await made.json()) as { agent: { id: string } }).agent.id;
  const issued = await as.post(`/api/projects/${projectId}/agents/${agentId}/tokens`, {
    data: { name: "asks" },
  });
  const token = ((await issued.json()) as { secret: string }).secret;
  const headers = { Authorization: `Bearer ${token}` };

  const board = await (await as.get(`/api/projects/${projectId}/board`, { headers })).json();
  const task = (board.tasks as { id: string; key: string; title: string }[]).find(
    (t) => t.title === "Pick a queue",
  )!;
  const runId = await ask(page, headers, task.id, "Which service owns the queue?");
  return { account, projectId, headers, runId, taskId: task.id, key: task.key };
}

/** The agent claims the task and asks its question. Answers the run. */
async function ask(page: Page, headers: Record<string, string>, taskId: string, question: string) {
  const started = await page.request.post(`/api/tasks/${taskId}/run`, {
    headers,
    data: { goal: "Find out", step: "Reading" },
  });
  const runId = ((await started.json()) as { run: { id: string } }).run.id;
  const asked = await page.request.patch(`/api/runs/${runId}`, {
    headers,
    data: { status: "waiting", step: question },
  });
  expect(asked.ok()).toBeTruthy();
  return runId;
}

/** Another task of the project, made by the person, with its own ask on it. */
async function anotherAsk(
  page: Page,
  projectId: string,
  headers: Record<string, string>,
  title: string,
) {
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } });
  const task = ((await made.json()) as { task: { id: string; key: string } }).task;
  return { taskId: task.id, key: task.key, runId: await ask(page, headers, task.id, title) };
}

/** Moves the moment the run began to wait back by `minutes`. */
async function askedAgo(runId: string, minutes: number) {
  await inDatabase((client) =>
    client.query(
      "update agent_runs set asked_at = now() - ($2 || ' minutes')::interval where id = $1",
      [runId, String(minutes)],
    ),
  );
}

async function mailedAt(runId: string): Promise<Date | null> {
  return inDatabase(async (client) => {
    const { rows } = await client.query<{ ask_mailed_at: Date | null }>(
      "select ask_mailed_at from agent_runs where id = $1",
      [runId],
    );
    return rows[0]?.ask_mailed_at ?? null;
  });
}

/**
 * Reads the board until the ask is taken. A read is what looks, at most once
 * in ten seconds, so one read may come too soon after the last.
 */
async function untilTaken(page: Page, projectId: string, runId: string) {
  await expect
    .poll(
      async () => {
        await page.request.get(`/api/projects/${projectId}/board`);
        return mailedAt(runId);
      },
      { timeout: 40_000, intervals: [2_000] },
    )
    .not.toBeNull();
}

if (smtpPort) mailOn();
else mailOff();

function mailOn() {
  test.describe("An unanswered ask, with mail", () => {
    test("is emailed once to the person who touched the task, with a link that opens it", async ({
      page,
    }) => {
      const mail = await smtpReceiver(smtpPort);
      try {
        const { account, projectId, headers, runId, key } = await anAsk(page);
        await askedAgo(runId, 16);

        // The board read is what looks; nothing on the server runs a timer.
        await untilTaken(page, projectId, runId);
        const letter = await letterTo(mail, account.email);
        expect(letter.text).toContain("Reis asked a question on");
        expect(letter.text).toContain(`${key} Pick a queue`);
        expect(letter.text).toContain("Which service owns the queue?");
        const link = /(https?:\/\/\S+\?task=\S+)/.exec(letter.text)?.[1];
        expect(link).toContain(`/p/${projectId}?task=${key}`);

        await page.goto(link!);
        await expect(page.getByTestId("task-panel")).toBeVisible();
        await expect(page.getByTestId("task-title")).toHaveValue("Pick a queue");

        /* Never a second email. A later look is proved by a new ask it takes;
           that same look leaves the first ask, still waiting, alone. */
        const first = await mailedAt(runId);
        const later = await anotherAsk(page, projectId, headers, "Pick a cache");
        await askedAgo(later.runId, 16);
        await untilTaken(page, projectId, later.runId);
        await letterTo(mail, account.email);
        expect(await mailedAt(runId)).toEqual(first);
        expect(mail.letters.filter((l) => l.text.includes(`${key} Pick a queue`))).toHaveLength(1);
      } finally {
        await mail.stop();
      }
    });

    test("is not emailed when a person answered first, or before 15 minutes", async ({ page }) => {
      const mail = await smtpReceiver(smtpPort);
      try {
        const { account, projectId, headers, runId, taskId } = await anAsk(page);
        const young = await anotherAsk(page, projectId, headers, "Pick a cache");

        // A person answers with a comment; the agent has not woken to read it.
        const answered = await page.request.post(`/api/tasks/${taskId}/comments`, {
          data: { body: "The billing service owns it." },
        });
        expect(answered.ok()).toBeTruthy();
        await askedAgo(runId, 16);
        await inDatabase((client) =>
          client.query(
            "update comments set created_at = now() - interval '10 minutes' where task_id = $1",
            [taskId],
          ),
        );
        await askedAgo(young.runId, 14);

        // One more ask is due, so the look that takes it has read the other two.
        const due = await anotherAsk(page, projectId, headers, "Pick a log store");
        await askedAgo(due.runId, 16);
        await untilTaken(page, projectId, due.runId);

        expect(await mailedAt(runId)).toBeNull();
        expect(await mailedAt(young.runId)).toBeNull();
        const letter = await letterTo(mail, account.email);
        expect(letter.text).toContain(`${due.key} Pick a log store`);
      } finally {
        await mail.stop();
      }
    });

    test("is not emailed to a person who turned these emails off", async ({ page }) => {
      const mail = await smtpReceiver(smtpPort);
      try {
        const { account, projectId, runId } = await anAsk(page);

        await page.goto("/account");
        const saved = page.waitForResponse(
          (res) => res.url().endsWith("/api/auth/me") && res.request().method() === "PATCH",
        );
        await page.getByRole("button", { name: "Turn off these emails" }).click();
        expect((await saved).status()).toBe(200);
        await page.reload();
        await expect(page.getByRole("button", { name: "Turn on these emails" })).toBeVisible();

        // The ask is still taken once; it simply goes to nobody.
        await askedAgo(runId, 16);
        await untilTaken(page, projectId, runId);
        // The send would follow the claim at once; give it room to arrive.
        await page.waitForTimeout(2_000);
        expect(mail.letters.filter((l) => l.to.includes(account.email))).toEqual([]);
      } finally {
        await mail.stop();
      }
    });
  });
}

function mailOff() {
  test.describe("An unanswered ask, with no mail", () => {
    test("leaves the account page as it was and the board working", async ({ page }) => {
      const { projectId, runId } = await anAsk(page);
      await askedAgo(runId, 16);

      await page.goto("/account");
      await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
      await expect(page.getByText("Questions from agents")).toHaveCount(0);

      await page.goto(`/p/${projectId}`);
      await expect(page.getByText("Pick a queue")).toBeVisible();
      // Nothing was taken, because nothing could be sent.
      expect(await mailedAt(runId)).toBeNull();
    });
  });
}
