import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { ME, newProject, renderWithBoard, withPerson, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * A field says who else is typing in it, and blocks nobody. This was a test of
 * `e2e/editing-sign.spec.ts`, and its name is the name it had there. The
 * other tabs speak through the stream, as the server relays them; the walk
 * with two real people on one task stays end to end.
 */

const byTestId = (id: string) => page.getByTestId(id);
const sign = () => byTestId("editing-sign");

afterEach(async () => {
  await page.viewport(1440, 900);
});

test("two editors are named together, and the line fits a phone", async () => {
  const data = newProject();
  const anna = withPerson(data, "Anna Person");
  const ben = withPerson(data, "Ben Person");
  const task = withTask(data, "Crowded title", { Status: "Todo" });
  await page.viewport(390, 844);
  const { hear } = await renderWithBoard(
    <BoardShell initialTask={task.key} />,
    data,
    serving(data).answer,
  );
  await expect.element(byTestId("task-title")).toBeVisible();

  const say = (
    clientId: string,
    userId: string,
    field: string | null,
    taskId: string | null = task.id,
  ) => hear({ clientId, userId, taskId, field });
  say("anna-tab", anna.id, null);
  say("ben-tab", ben.id, null);
  await expect.poll(() => byTestId("panel-present-face").elements().length).toBe(2);

  say("anna-tab", anna.id, "title");
  say("ben-tab", ben.id, "title");
  // A tab of my own is never named: I know where I type.
  say("my-other-tab", ME.id, "title");
  await expect
    .element(sign())
    .toHaveTextContent("Anna Person and Ben Person are editing the title");

  const line = sign().element().getBoundingClientRect();
  expect(line.x + line.width).toBeLessThanOrEqual(390);
  const title = byTestId("task-title").element().getBoundingClientRect();
  expect(line.y).toBeGreaterThanOrEqual(title.y + title.height);

  // A tab that goes to another page stops editing too.
  say("ben-tab", ben.id, null, null);
  await expect.element(sign()).toHaveTextContent("Anna Person is editing the title");
});
