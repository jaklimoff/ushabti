import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { newProject, renderWithBoard, withPerson, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * Faces in the panel's header on a phone. This was a test of
 * `e2e/presence.spec.ts`, and its name is the name it had there. The other
 * tabs speak through the stream, as the server relays them; two people, a
 * closed tab and a dying one stayed end to end.
 */

const byTestId = (id: string) => page.getByTestId(id);

afterEach(async () => {
  await page.viewport(1440, 900);
});

test("three faces fit the header of a phone", async () => {
  const data = newProject();
  const others = ["Ada Lovelace", "Grace Hopper", "Barbara Liskov"].map((name) =>
    withPerson(data, name),
  );
  const task = withTask(data, "Crowded", { Status: "Todo" });
  await page.viewport(390, 844);
  const { hear } = await renderWithBoard(
    <BoardShell initialTask={task.key} />,
    data,
    serving(data).answer,
  );
  await expect.element(byTestId("task-key")).toBeVisible();

  others.forEach((other, i) =>
    hear({ clientId: `tab-${i}`, userId: other.id, taskId: task.id, field: null }),
  );
  await expect.poll(() => byTestId("panel-present-face").elements().length).toBe(3);

  const head = byTestId("task-key").element().parentElement!.getBoundingClientRect();
  for (const button of ["Task menu", "Close task"]) {
    const box = page.getByRole("button", { name: button }).element().getBoundingClientRect();
    expect(box.x + box.width).toBeLessThanOrEqual(head.x + head.width + 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});
