import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { SessionUser } from "@/components/ui/UserMenu";
import { ME, newProject, renderWithBoard, withPerson, withTask } from "@/test/board";
import { boxValue, fillBox, serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * Two people write the same words. Fields save on blur, so the second blur
 * used to win in silence. Now the second one is refused, and the field asks,
 * in place, which words stay. Each test was a test of
 * `e2e/text-save.spec.ts`, and its name is the name it had there. Ben is the
 * tab on screen; Anna's save is put in the fake first, as her tab would have
 * landed it. The refusal itself is the route's, held by
 * `text-save-route.test.ts` and `comment-edit.test.ts`.
 */

const TASK = /^\/api\/tasks\/[0-9a-f-]+$/;
const ITEM = /^\/api\/checklist\/[0-9a-f-]+$/;
const byTestId = (id: string) => page.getByTestId(id);
const mod = (key: string) => userEvent.keyboard(`{ControlOrMeta>}${key}{/ControlOrMeta}`);

/** Anna owns the project, Ben is a member, and Ben has the task open. */
async function twoPeople() {
  const data = newProject();
  data.members[0].name = "Anna Owner";
  const anna = { ...data.members[0] };
  const benMember = withPerson(data, "Ben Friend");
  const ben: SessionUser = { ...benMember, email: benMember.email! };
  data.project.role = "member";
  const task = withTask(data, "Shared words", { Status: "Todo" });
  const server = serving(data, ben);
  const drawn = await renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer, {
    user: ben,
  });
  await expect.element(byTestId("task-panel")).toBeVisible();
  return { ...drawn, ...server, task, anna };
}

describe("A text save does not overwrite a change it did not see", () => {
  test("the description asks in place, and Keep mine saves the second words", async () => {
    const { sent, wrote, taskOf, task, anna } = await twoPeople();

    await page.getByText("Add a description…").click();
    await fillBox("Ben wrote this.");
    wrote(task, { description: "Anna wrote this." }, anna);
    await mod("{Enter}");

    const question = byTestId("changed-while-typing");
    await expect.element(question).toMatchTextContent("This changed while you typed");
    await expect.element(question).toMatchTextContent("Anna Owner saved it first");
    await expect
      .element(question.getByTestId("changed-theirs"))
      .toHaveTextContent("Anna wrote this.");
    await expect.element(question.getByTestId("changed-mine")).toHaveTextContent("Ben wrote this.");
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    expect(page.getByRole("alertdialog").elements()).toHaveLength(0);
    expect(taskOf(task.id)!.description).toBe("Anna wrote this.");

    await question.getByRole("button", { name: "Keep mine" }).click();
    await expect.element(question).not.toBeInTheDocument();
    await expect.element(byTestId("markdown")).toHaveTextContent("Ben wrote this.");
    expect(taskOf(task.id)!.description).toBe("Ben wrote this.");
    // The second send carries what Anna wrote as its base, so it lands.
    expect(sent("PATCH", TASK).map((r) => r.body)).toEqual([
      expect.objectContaining({ description: "Ben wrote this.", baseDescription: "" }),
      expect.objectContaining({
        description: "Ben wrote this.",
        baseDescription: "Anna wrote this.",
      }),
    ]);
  });

  test("the title asks too, and Take theirs drops the second words", async () => {
    const { sent, wrote, taskOf, task, anna } = await twoPeople();

    const title = byTestId("task-title");
    await title.fill("Ben's title");
    wrote(task, { title: "Anna's title" }, anna);
    await userEvent.keyboard("{Enter}");

    const question = byTestId("changed-while-typing");
    await expect.element(question).toMatchTextContent("This changed while you typed");
    await expect.element(question.getByTestId("changed-theirs")).toHaveTextContent("Anna's title");
    await expect.element(question.getByTestId("changed-mine")).toHaveTextContent("Ben's title");

    await question.getByRole("button", { name: "Take theirs" }).click();
    await expect.element(question).not.toBeInTheDocument();
    await expect.element(byTestId("task-title")).toHaveValue("Anna's title");
    expect(taskOf(task.id)!.title).toBe("Anna's title");
    expect(sent("PATCH", TASK)).toHaveLength(1);
  });

  test("a checklist item's words ask in place, and name nobody", async () => {
    const { sent, item, itemWrote, task, ring } = await twoPeople();
    const first = item(task, "First step");
    ring();

    await page.getByText("First step").click();
    // The item's box takes the focus as it opens.
    await expect.poll(() => (document.activeElement as HTMLInputElement).value).toBe("First step");
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}Ben's step");
    itemWrote(first.id, "Anna's step");
    await userEvent.keyboard("{Enter}");

    const question = byTestId("changed-while-typing");
    await expect.element(question).toMatchTextContent(/This changed while you typed\./);
    await expect.element(question).not.toMatchTextContent("saved it first");
    await expect.element(question.getByTestId("changed-theirs")).toHaveTextContent("Anna's step");

    await question.getByRole("button", { name: "Keep mine" }).click();
    await expect.element(question).not.toBeInTheDocument();
    await expect.element(page.getByText("Ben's step")).toBeVisible();
    expect(sent("PATCH", ITEM).map((r) => r.body)).toEqual([
      { text: "Ben's step", baseText: "First step" },
      { text: "Ben's step", baseText: "Anna's step" },
    ]);
  });

  test("an open box nobody typed in follows every save, and is not typing", async () => {
    /* Here the tab on screen is Anna's, and Ben saves. */
    const data = newProject();
    const ben = withPerson(data, "Ben Friend");
    const task = withTask(data, "Shared words", { Status: "Todo" });
    const server = serving(data, ME);
    const { sent, ring } = await renderWithBoard(
      <BoardShell initialTask={task.key} />,
      data,
      server.answer,
    );

    await page.getByText("Add a description…").click();
    await expect.element(byTestId("live-editor")).toHaveFocus();

    // Ben saves twice while Anna's box is open and untouched.
    for (const words of ["Ben's first words.", "Ben's second words."]) {
      server.wrote(task, { description: words }, ben);
      ring();
      await expect.poll(boxValue).toBe(words);
    }

    // Her own words start from Ben's second save, so the server takes them.
    await mod("{End}");
    await userEvent.keyboard(" Anna agrees.");
    await mod("{Enter}");
    await expect.poll(() => sent("PATCH", TASK).length).toBe(1);
    expect(sent("PATCH", TASK)[0].body).toMatchObject({
      description: "Ben's second words. Anna agrees.",
      baseDescription: "Ben's second words.",
    });
    await expect
      .element(byTestId("markdown"))
      .toHaveTextContent("Ben's second words. Anna agrees.");
    expect(byTestId("changed-while-typing").elements()).toHaveLength(0);
    expect(server.taskOf(task.id)!.description).toBe("Ben's second words. Anna agrees.");
  });
});
