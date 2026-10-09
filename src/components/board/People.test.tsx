import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { newProject, propertyOf, renderWithBoard, withPerson, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * A person property offers the members. This was a test of
 * `e2e/collaboration.spec.ts`, and its name is the name it had there. The
 * spec added the friend through People and went back by a new page; here the
 * friend is on the board, and the second drawing reads what the server kept.
 * Two people on one board stayed end to end.
 */

const panel = () => page.getByTestId("task-panel");

test("a person property lists the members and sticks", async () => {
  const data = newProject();
  const friend = withPerson(data, "Friend Person");
  const task = withTask(data, "Give it to a friend", { Status: "Todo" });
  const assignee = propertyOf(data, "Assignee");
  const server = serving(data);
  const first = await renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer);

  await panel().getByRole("button", { name: "Unassigned" }).click();
  await panel().getByRole("option", { name: "Friend Person" }).click();
  await expect
    .poll(() => first.sent("PUT", new RegExp(`/values/${assignee.id}$`)).map((s) => s.body))
    .toEqual([{ value: friend.id }]);
  await first.screen.unmount();

  // The board as it is read again, with the panel opened on the same task.
  await renderWithBoard(<BoardShell initialTask={task.key} />, server.server, server.answer);
  await expect.element(panel().getByRole("button", { name: "Friend Person" })).toBeVisible();
});
