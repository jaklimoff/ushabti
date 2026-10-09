import { useEffect, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page, type Locator } from "vitest/browser";
import { cleanup } from "vitest-browser-react";
import { Archive } from "@/components/archive/Archive";
import type { BoardData, TaskDTO } from "@/lib/types";
import {
  ME,
  newProject,
  optionOf,
  propertyOf,
  renderWithBoard,
  withTask,
  type Answer,
} from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * Archiving, and the panel of a task that is archived. Each test here was a
 * test of `e2e/archive.spec.ts`, and its name is the name it had there; the
 * two with `@smoke` on them stayed end to end. A reload there is the fake
 * server's copy read here.
 */

const TASK = /^\/api\/tasks\/[0-9a-f-]+$/;
const TASK_ARCHIVE = /^\/api\/tasks\/([0-9a-f-]+)\/archive$/;
const COLUMN_ARCHIVE = /^\/api\/projects\/[0-9a-f-]+\/archive$/;
const VALUE = /^\/api\/tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+$/;
const COMMENTS = /^\/api\/tasks\/[0-9a-f-]+\/comments$/;

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const column = (name: string) =>
  byTestId("column").filter({
    has: byTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });

afterEach(async () => {
  await page.viewport(1440, 900);
});

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/** The element's words hold `text`. `toHaveTextContent` asks for all of them. */
async function says(locator: Locator, text: string) {
  await expect.poll(() => locator.element().textContent ?? "").toContain(text);
}

/** The Priority row of the open panel. A locator made from an element is made
    from what it draws now, so it is asked for afresh each time. */
const priority = (name: string) =>
  page
    .elementLocator(
      document.querySelector('[data-testid="task-panel"] [data-property="Priority"]')!,
    )
    .getByRole("button", { name, exact: true });

/** Takes tasks off the board into the archived list, and hands back their
    whole rows, which is what a read of one answers. */
function archive(data: BoardData, ...tasks: TaskDTO[]): TaskDTO[] {
  const archivedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const gone = new Set(tasks.map((t) => t.id));
  data.tasks = data.tasks.filter((t) => !gone.has(t.id));
  return tasks.map((t) => {
    data.archived.push({
      id: t.id,
      number: t.number,
      key: t.key,
      title: t.title,
      description: t.description,
      position: t.position,
      archivedAt,
    });
    return { ...t, archivedAt };
  });
}

/**
 * The fake server, with the archive of one task added: the task leaves the
 * board's list for the archived one, and comes back. `shelf` holds the whole
 * rows a read of an archived task answers. A task that is archived in the
 * test is on it from the start, so give it the live task too.
 */
function drawing(data: BoardData, shelf: TaskDTO[] = []) {
  const fake = serving(data, ME, shelf);
  const answer: Answer = (sent) => {
    const m = TASK_ARCHIVE.exec(sent.path);
    if (m && sent.method === "POST") {
      const task = fake.server.tasks.find((t) => t.id === m[1])!;
      const now = new Date().toISOString();
      fake.server.tasks = fake.server.tasks.filter((t) => t !== task);
      fake.server.archived.push({
        id: task.id,
        number: task.number,
        key: task.key,
        title: task.title,
        description: task.description,
        position: task.position,
        archivedAt: now,
      });
      const whole = fake.taskOf(task.id)!;
      whole.archivedAt = now;
      return { body: { ok: true } };
    }
    if (m && sent.method === "DELETE") {
      const whole = fake.taskOf(m[1])!;
      whole.archivedAt = null;
      fake.server.archived = fake.server.archived.filter((t) => t.id !== m[1]);
      fake.server.tasks.push(whole);
      return { body: { ok: true } };
    }
    /* A column names a value; the fake's archive takes the ids it holds. */
    const by = sent.body as { propertyId?: string; value?: unknown } | undefined;
    if (sent.method === "POST" && COLUMN_ARCHIVE.test(sent.path) && by?.propertyId) {
      const taskIds = fake.server.tasks
        .filter((t) => t.values[by.propertyId!] === by.value)
        .map((t) => t.id);
      return fake.answer({ ...sent, body: { taskIds } });
    }
    return fake.answer(sent);
  };
  return { ...fake, answer };
}

const later = { open: (_key: string | null) => {} };
/** The board, with a task opened later by its link, so that a test can hold
    the read before the link is followed. */
function Late() {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    later.open = setKey;
  }, []);
  return <BoardShell key={key ?? "none"} initialTask={key} />;
}

async function draw(data: BoardData, open: string | null, shelf: TaskDTO[] = []) {
  const fake = drawing(data, shelf);
  const drawn = await renderWithBoard(<BoardShell initialTask={open} />, data, fake.answer);
  return { ...drawn, fake };
}

/** Wraps `fetch` once more, so a test can hold or change one answer. */
function around(
  hook: (
    sent: { method: string; path: string },
    pass: () => Promise<Response>,
  ) => Promise<Response> | undefined,
) {
  const before = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), location.origin).pathname;
    const pass = () => before(input, init);
    return hook({ method: init?.method ?? "GET", path }, pass) ?? pass();
  });
}

/* A read the panel throws away changes nothing on screen, so there is no
   event to wait for. This counts the answers the panel has parsed instead:
   the count goes up in the same chain of microtasks that hands the answer to
   the panel. */
function countDetailReads() {
  let reads = 0;
  const json = Response.prototype.json;
  const spy = vi.spyOn(Response.prototype, "json").mockImplementation(async function (
    this: Response,
  ) {
    const parsed: unknown = await json.call(this);
    /* A fake answer has no url, so a read of one task is known by its shape. */
    const task = (parsed as { task?: { comments?: unknown } } | null)?.task;
    if (task && Array.isArray(task.comments)) reads += 1;
    return parsed;
  });
  return { count: () => reads, done: () => spy.mockRestore() };
}

const comments = () => page.getByRole("tab", { name: /^Comments/ });

describe("Archiving a task", () => {
  test("archives everything in a column, after a question that names the count", async () => {
    const data = newProject();
    const first = withTask(data, "First shipped", { Status: "Shipped" });
    const second = withTask(data, "Second shipped", { Status: "Shipped" });
    withTask(data, "Still to do", { Status: "Todo" });
    const shelf = [first, second].map((t) => ({ ...t, archivedAt: minuteAgo() }));
    const { sent } = await draw(data, null, shelf);

    const count = () => column("Shipped").getByTestId("column-count");
    await says(count(), "2");

    await page.getByRole("button", { name: "Archive everything in Shipped" }).click();
    const question = byTestId("column-confirm");
    await says(question, "Archive 2 tasks in Shipped?");
    await says(question, "They leave the board and keep their history.");

    // Cancel leaves the column alone.
    await page.getByRole("button", { name: "Cancel" }).click();
    await says(count(), "2");
    expect(sent("POST", COLUMN_ARCHIVE)).toHaveLength(0);

    await page.getByRole("button", { name: "Archive everything in Shipped" }).click();
    await page.getByRole("button", { name: /^Yes, archive$/ }).click();

    await expect.poll(() => sent("POST", COLUMN_ARCHIVE).length).toBe(1);
    await gone(column("Shipped").getByTestId("card"));
    await expect.element(card("Still to do").first()).toBeVisible();
    // The board says how many went, in the server's own number.
    await says(byTestId("toast"), "Archived 2 tasks");

    /* An empty column is not proof of an archive: a delete would leave the
       same board. So find one of them, see the word on its row, open it. */
    await byTestId("search-box").fill("first shipped");
    const hit = byTestId("search-hit").first();
    await says(hit, "First shipped");
    await says(hit, "archived");
    await hit.click();
    await expect.element(byTestId("archived-row")).toBeVisible();

    // And it comes back where it was.
    await page.getByRole("button", { name: "Put back", exact: true }).click();
    await expect.poll(() => sent("DELETE", TASK_ARCHIVE).length).toBe(1);
    await expect.element(card("First shipped").first()).toBeVisible();
    await says(count(), "1");
  });

  test("a search still finds an archived task, says so, and its link opens it", async () => {
    const data = newProject();
    const task = withTask(data, "Rate limit the sign-in route", { Status: "Todo" });
    const shelf = archive(data, task);
    await draw(data, null, shelf);

    await byTestId("search-box").fill("rate limit");
    const hit = byTestId("search-hit").first();
    await says(hit, "Rate limit the sign-in route");
    await says(hit, "archived");

    await hit.click();
    await expect.element(byTestId("task-title")).toHaveValue("Rate limit the sign-in route");
    await expect.element(byTestId("archived-row")).toBeVisible();

    // The link a person pastes into a chat opens the panel, with no card behind it.
    await cleanup();
    await draw(data, task.key, shelf);
    await expect.element(byTestId("task-panel")).toBeVisible();
    await expect.element(byTestId("task-title")).toHaveValue("Rate limit the sign-in route");
    await expect.element(byTestId("archived-row")).toBeVisible();
    await gone(byTestId("card"));
  });

  test("a link to an archived task draws its head before the detail lands", async () => {
    const data = newProject();
    const task = withTask(data, "Rotate the signing key", { Status: "Todo" });
    const shelf = archive(data, task);
    const fake = drawing(data, shelf);
    await renderWithBoard(<Late />, data, fake.answer);

    /* Hold back the one read the panel makes for itself, and let it go when
       the assertions have run. */
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    around(({ method, path }, pass) =>
      method === "GET" && TASK.test(path) ? held.then(pass) : undefined,
    );
    later.open(task.key);

    // The read is still out: the panel says so, and the head is already there.
    await expect.element(byTestId("panel-loading")).toBeVisible();
    await expect.element(byTestId("task-key")).toHaveTextContent(task.key);
    await expect.element(byTestId("task-title")).toHaveValue("Rotate the signing key");
    await expect.element(byTestId("archived-row")).toBeVisible();

    // Then the rest of the task arrives, and no card is drawn behind it.
    release();
    await gone(byTestId("panel-loading"));
    await expect.element(comments()).toBeVisible();
    await gone(byTestId("card"));
  });

  test("a property changed on an archived task stays on screen", async () => {
    const data = newProject();
    const task = withTask(data, "Rotate the backup key", { Status: "Todo" });
    const shelf = archive(data, task);
    const { sent, fake } = await draw(data, task.key, shelf);

    await expect.element(comments()).toBeVisible();
    await priority("High").click();
    await expect.poll(() => sent("PUT", VALUE).length).toBe(1);
    await expect.element(priority("High")).toHaveAttribute("title", "Click to clear");

    // And it was saved, which is the half that always worked.
    expect(fake.taskOf(task.id)!.values[propertyOf(data, "Priority").id]).toBe(
      optionOf(data, "Priority", "High"),
    );
  });

  test("a refused value write on an archived task draws the old value again", async () => {
    const data = newProject();
    const task = withTask(data, "Rotate the backup key", { Status: "Todo" });
    const shelf = archive(data, task);
    const { sent } = await draw(data, task.key, shelf);

    // The value the server really holds.
    await expect.element(comments()).toBeVisible();
    await priority("Low").click();
    await expect.poll(() => sent("PUT", VALUE).length).toBe(1);
    await expect.element(priority("Low")).toHaveAttribute("title", "Click to clear");

    around(({ method, path }) =>
      method === "PUT" && VALUE.test(path)
        ? Promise.resolve(
            new Response(JSON.stringify({ error: "The change did not save." }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }),
          )
        : undefined,
    );
    await priority("High").click();

    // The refusal is told, which is the half that always worked.
    await says(byTestId("toast"), "The change did not save.");

    // And the panel draws what the server holds, not what was clicked.
    await expect.element(priority("Low")).toHaveAttribute("title", "Click to clear");
    await expect.element(priority("High")).toHaveAttribute("title", "High");
  });

  test("a read the panel's own write overtook is thrown away", async () => {
    const data = newProject();
    const task = withTask(data, "Rotate the signing key", { Status: "Todo" });
    const shelf = archive(data, task);
    const { sent, ring } = await draw(data, task.key, shelf);
    await expect.element(comments()).toBeVisible();
    const reads = countDetailReads();

    /* The first read is copied, the second is held. Held and released, the
       fake would answer with the write already in it. So the held one answers
       with the copy, which is the task as it was. */
    let mode: "real" | "copy" | "hold" = "copy";
    let stale = "";
    let arrived = () => {};
    let release = () => {};
    const second = new Promise<void>((resolve) => (arrived = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    around(({ method, path }, pass) => {
      if (method !== "GET" || !TASK.test(path)) return undefined;
      if (mode === "copy") {
        mode = "real";
        return pass().then(async (res) => {
          stale = await res.clone().text();
          return res;
        });
      }
      if (mode === "hold") {
        mode = "real";
        arrived();
        return held.then(
          () => new Response(stale, { headers: { "Content-Type": "application/json" } }),
        );
      }
      return undefined;
    });

    /* A broadcast is what starts a read the panel did not ask for. */
    ring();
    await expect.poll(() => stale).not.toBe("");
    mode = "hold";
    ring();
    await second;

    await priority("High").click();
    await expect.poll(() => sent("PUT", VALUE).length).toBe(1);
    await expect.element(priority("High")).toHaveAttribute("title", "Click to clear");

    const parsed = reads.count();
    release();
    await expect.poll(() => reads.count()).toBeGreaterThan(parsed);

    // The old answer landed and was thrown away.
    await expect.element(priority("High")).toHaveAttribute("title", "Click to clear");
    reads.done();
  });

  test("a value picked while Archive is on its way stays on screen", async () => {
    const data = newProject();
    const task = withTask(data, "Rotate the backup key", { Status: "Todo" });
    const { sent } = await draw(data, task.key, [task]);
    /* The first read of the task lands before the test goes on, because
       Archive is a write too and would make it wait. */
    await expect.element(comments()).toBeVisible();
    const reads = countDetailReads();

    /* Archive is done on the server but answered only when the test says. */
    let answerArchive = () => {};
    const archiveHeld = new Promise<void>((resolve) => (answerArchive = resolve));
    /* The value reaches the server only after the read Archive starts has
       been answered and parsed, so that answer is from before the value. */
    let sendValue = () => {};
    const valueHeld = new Promise<void>((resolve) => (sendValue = resolve));
    let valueOut = false;
    around(({ method, path }, pass) => {
      if (method === "POST" && TASK_ARCHIVE.test(path))
        return pass().then(async (res) => {
          await archiveHeld;
          return res;
        });
      if (method === "PUT" && VALUE.test(path)) {
        valueOut = true;
        return valueHeld.then(pass);
      }
      return undefined;
    });

    await page.getByRole("button", { name: "Task menu" }).click();
    await byTestId("archive-task").click();
    await expect.element(byTestId("archived-row")).toBeVisible();

    await priority("High").click();
    await expect.poll(() => valueOut).toBe(true);

    const parsed = reads.count();
    answerArchive();
    await expect.poll(() => reads.count()).toBeGreaterThan(parsed);

    sendValue();
    await expect.poll(() => sent("PUT", VALUE).length).toBe(1);

    // The read that crossed the value was thrown away, and the value stays.
    await expect.element(priority("High")).toHaveAttribute("title", "Click to clear");
    reads.done();
  });
});

describe("A read that crosses a write", () => {
  test("a read that crossed a comment on its way is thrown away", async () => {
    const data = newProject();
    const task = withTask(data, "Rotate the backup key", { Status: "Todo" });
    const { sent, ring } = await draw(data, task.key);
    await comments().click();
    const reads = countDetailReads();

    /* The first read the test starts is copied: the task before any comment.
       The next one it asks for answers with that copy, which is a read from
       before the comment that follows. */
    let mode: "real" | "copy" | "stale" = "copy";
    let stale = "";
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding = false;
    around(({ method, path }, pass) => {
      if (method === "POST" && COMMENTS.test(path) && holding) return held.then(pass);
      if (method !== "GET" || !TASK.test(path)) return undefined;
      if (mode === "copy") {
        mode = "real";
        return pass().then(async (res) => {
          stale = await res.clone().text();
          return res;
        });
      }
      if (mode === "stale") {
        mode = "real";
        return Promise.resolve(
          new Response(stale, { headers: { "Content-Type": "application/json" } }),
        );
      }
      return undefined;
    });
    ring();
    await expect.poll(() => stale).not.toBe("");

    const comment = (text: string) => byTestId("comment").filter({ hasText: text });
    const box = byTestId("comment-box");
    const post = page.getByRole("button", { name: "Comment", exact: true });
    await box.fill("The old key goes on Friday.");
    await post.click();
    await expect.element(comment("The old key goes on Friday.")).toBeVisible();

    /* The next comment is held on its way, and a read goes out meanwhile. */
    holding = true;
    await box.fill("The new key is in the vault.");
    await post.click();
    mode = "stale";
    const parsed = reads.count();
    ring();
    await expect.poll(() => reads.count()).toBeGreaterThan(parsed);

    // The read that crossed the comment was thrown away.
    await expect.element(comment("The old key goes on Friday.")).toBeVisible();

    release();
    await expect.element(comment("The new key is in the vault.")).toBeVisible();
    await expect.element(comment("The old key goes on Friday.")).toBeVisible();
    expect(sent("POST", COMMENTS)).toHaveLength(2);
    reads.done();
  });
});

describe("The archive on a phone", () => {
  test("the archive page fits the screen, and every way back is pressable", async () => {
    await page.viewport(390, 780);
    const data = newProject();
    const tasks = ["A short one", "A title long enough to need the whole of a small screen"].map(
      (title) => withTask(data, title, { Status: "Todo" }),
    );
    archive(data, ...tasks);
    await renderWithBoard(<Archive initial={data} deleted={[]} user={ME} />, data);

    await expect.poll(() => byTestId("archive-row").elements().length).toBe(2);

    const doc = document.documentElement;
    expect(Math.max(doc.scrollWidth - doc.clientWidth, 0)).toBe(0);

    // A finger needs 24 px each way, whatever a mouse would settle for.
    const buttons = page.getByRole("button", { name: /^Put .* back$/ }).elements();
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      expect(box.width, `${button.ariaLabel} is ${box.width} px wide`).toBeGreaterThanOrEqual(24);
      expect(box.height, `${button.ariaLabel} is ${box.height} px tall`).toBeGreaterThanOrEqual(24);
    }
  });
});

function minuteAgo() {
  return new Date(Date.now() - 60_000).toISOString();
}
