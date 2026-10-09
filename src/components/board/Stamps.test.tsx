import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { CardViewPanel } from "@/components/settings/CardViewPanel";
import { ME, newProject, renderWithBoard, withTask, type Answer } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * Created and Updated wait to be turned on. This was a test of
 * `e2e/stamps.spec.ts`, and its name is the name it had there. The page and
 * the board share one store, so the card changes in the same breath where the
 * spec went there by a new page. The server and the browser reading the same
 * day stayed end to end; the order by Updated is `stamps.test.ts`.
 *
 * The line in the panel was the last test of `e2e/changed.spec.ts`, and has
 * its name. What moves the changed time is the server's write, and is
 * `changed-route.test.ts`; here the fake moves it as the comment route does.
 */

const byTestId = (id: string) => page.getByTestId(id);
/* The page draws a card of its own as a preview, so a card is the board's. */
const card = (title: string) =>
  byTestId("board-canvas").getByTestId("card").filter({ hasText: title });
const opener = (name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name} on the card`) });
const row = (name: string) => byTestId("card-row").filter({ has: opener(name) });
const listHead = (name: string) =>
  byTestId("list-head-cell").filter({
    has: byTestId("list-head-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });
const stamped = (title: string, which: string) =>
  card(title).element().querySelectorAll(`[title^="${which}"]`).length;

test("Created and Updated wait to be turned on, then read on the card and in a list", async () => {
  const data = newProject();
  withTask(data, "Stamped", { Status: "Todo" });
  data.views.push({
    ...data.views[0],
    id: "00000000-0000-4000-8000-777777777778",
    name: "Rows",
    kind: "list",
    position: "z0000000",
    isDefault: false,
  });
  await renderWithBoard(
    <>
      <CardViewPanel />
      <BoardShell initialTask={null} />
    </>,
    data,
    serving(data).answer,
  );

  await expect.element(card("Stamped")).toBeVisible();
  expect(
    card("Stamped")
      .getByTestId("card-chip")
      .elements()
      .filter((chip) => /^(Created|Updated)/.test(chip.textContent ?? "")),
  ).toHaveLength(0);
  expect(stamped("Stamped", "Updated")).toBe(0);
  expect(stamped("Stamped", "Created")).toBe(0);

  await opener("Updated").click();
  await page.getByRole("button", { name: "Put Updated in the footer left" }).click();
  await expect.element(row("Updated")).toHaveAttribute("data-place", "footerL");
  await expect.poll(() => stamped("Stamped", "Updated · ")).toBe(1);
  expect(stamped("Stamped", "Created")).toBe(0);

  await byTestId("view-pill").filter({ hasText: "Rows" }).click();
  await expect.element(byTestId("list-view")).toBeVisible();
  expect(listHead("Updated").elements()).toHaveLength(1);
  expect(listHead("Created").elements()).toHaveLength(0);
});

test("the panel says when the task was made, by whom, and when it changed", async () => {
  const data = newProject();
  /* Made on a known day of this year, so the words can be read exactly: a
     day of another year would carry its year. */
  const year = new Date().getUTCFullYear();
  const task = withTask(data, "Stamped", { Status: "Todo" });
  task.createdAt = `${year}-01-03T09:30:00.000Z`;
  task.updatedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const fake = serving(data);
  let creator: { id: string; name: string } | null = { id: ME.id, name: "Ana Maker" };
  const answer: Answer = (sent) => {
    const said = fake.answer(sent);
    const whole = fake.taskOf(task.id)!;
    if (sent.method === "POST" && sent.path.endsWith("/comments"))
      whole.updatedAt = new Date().toISOString();
    if (sent.method === "GET" && sent.path === `/api/tasks/${task.id}`) {
      const read = (said!.body as { task: Record<string, unknown> }).task;
      return {
        body: {
          task: {
            ...read,
            creator: creator && { ...creator, color: "#888", emoji: null, kind: "human" },
          },
        },
      };
    }
    return said;
  };
  const { screen } = await renderWithBoard(<BoardShell initialTask={task.id} />, data, answer);

  const stamp = byTestId("task-stamp");
  await expect.element(stamp).toHaveTextContent("Made 3 Jan by Ana Maker·changed 2 hours ago");
  await expect.element(byTestId("task-made")).toHaveAttribute("title", `3 Jan ${year}, 09:30 UTC`);
  expect(byTestId("task-changed").element().getAttribute("title")).toMatch(/UTC$/);

  /* A comment is a change, and the line hears it. */
  await byTestId("comment-box").fill("A word");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect.poll(() => stamp.element().textContent).toContain("changed just now");

  /* Nobody's account behind it: the line drops "by". */
  creator = null;
  await screen.unmount();
  await renderWithBoard(<BoardShell initialTask={task.id} />, data, answer, { keepStorage: true });
  await expect
    .poll(() => byTestId("task-stamp").element().textContent)
    .toMatch(/^Made 3 Jan·changed /);
});
