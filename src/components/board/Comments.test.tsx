import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { SessionUser } from "@/components/ui/UserMenu";
import type { BoardData, TaskDTO } from "@/lib/types";
import { ME, newProject, renderWithBoard, withPerson, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * What the panel does with a comment somebody edits or takes down. Each test
 * was a test of `e2e/comment-edit.spec.ts` or `e2e/comment-delete.spec.ts`,
 * and its name is the name it had there. Who the routes let do it is
 * `comments-route.test.ts`.
 */

const COMMENT = /^\/api\/comments\/[0-9a-f-]+$/;
const byTestId = (id: string) => page.getByTestId(id);
const editor = () => byTestId("comment-editor");

/** One task with one comment of the person signed in. */
async function oneComment(user: SessionUser = ME) {
  const data = newProject();
  const task = withTask(data, "Talked about", { Status: "Todo" });
  const server = serving(data, user);
  server.comment(task, "The tests are gren", { ...ME, kind: "human" });
  const drawn = await draw(data, task, server, user);
  await expect.element(byTestId("comment-markdown")).toHaveTextContent("The tests are gren");
  return { ...drawn, ...server, task };
}

async function draw(
  data: BoardData,
  task: TaskDTO,
  server: ReturnType<typeof serving>,
  user: SessionUser = ME,
) {
  return renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer, { user });
}

async function openEdit() {
  await byTestId("comment").hover();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect.element(editor()).toBeVisible();
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe("The author of a comment can edit it", () => {
  test("Escape puts the old words back, and the same words write nothing", async () => {
    const { sent } = await oneComment();

    await openEdit();
    await editor().fill("Thrown away");
    await userEvent.keyboard("{Escape}");
    await expect.element(editor()).not.toBeInTheDocument();
    await expect.element(byTestId("comment-markdown")).toHaveTextContent("The tests are gren");

    await openEdit();
    // An empty box is not a save: Mod + Enter leaves it open.
    await editor().fill("");
    await userEvent.keyboard("{ControlOrMeta>}{Enter}{/ControlOrMeta}");
    await expect.element(editor()).toBeVisible();
    await editor().fill("The tests are gren");
    await userEvent.keyboard("{ControlOrMeta>}{Enter}{/ControlOrMeta}");
    await expect.element(editor()).not.toBeInTheDocument();

    await settle();
    expect(sent("PATCH", COMMENT)).toEqual([]);
    await expect.element(byTestId("comment-edited")).not.toBeInTheDocument();
  });

  /* A comment is a sentence somebody signed: a misclick must not rewrite it. */
  test("a click away from the box writes nothing and leaves the words in it", async () => {
    const { sent } = await oneComment();

    await openEdit();
    await editor().fill("Not yet");
    await byTestId("comment-box").click();
    await expect.element(editor()).not.toHaveFocus();
    await expect.element(editor()).toHaveValue("Not yet");
    await expect.element(page.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
    await settle();
    expect(sent("PATCH", COMMENT)).toEqual([]);

    // Mod + Enter saves, as it posts in the composer.
    await editor().click();
    await userEvent.keyboard("{ControlOrMeta>}{Enter}{/ControlOrMeta}");
    await expect.element(editor()).not.toBeInTheDocument();
    await expect.element(byTestId("comment-markdown")).toHaveTextContent("Not yet");
    await expect.element(byTestId("comment-edited")).toBeVisible();
    expect(sent("PATCH", COMMENT).map((r) => r.body)).toEqual([
      { body: "Not yet", baseBody: "The tests are gren" },
    ]);
  });

  test("Cancel puts the old words back and writes nothing", async () => {
    const { sent } = await oneComment();

    await openEdit();
    await editor().fill("Thrown away");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(editor()).not.toBeInTheDocument();
    await expect.element(byTestId("comment-markdown")).toHaveTextContent("The tests are gren");

    // Opened again, it holds the saved words, not the thrown away ones.
    await openEdit();
    await expect.element(editor()).toHaveValue("The tests are gren");
    expect(sent("PATCH", COMMENT)).toEqual([]);
  });

  /* A save is a press now, so a closed tab has nothing to send. End to end
     could only read the row afterwards; here the leave itself is watched. */
  test("words typed and left in a closed tab are not saved", async () => {
    const { sent } = await oneComment();

    await openEdit();
    await editor().fill("Left in a closed tab");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));

    await settle();
    expect(sent("PATCH", COMMENT)).toEqual([]);
  });
});

describe("Deleting a comment", () => {
  /* The screen half of the e2e test of the same name: what each person is
     offered, and the question before anything goes. The refusal itself is
     `comments-route.test.ts`. */
  test("a member cannot delete somebody's comment, an admin can, and both are asked first", async () => {
    const data = newProject();
    const anna = { ...ME, name: "Anna Owner" };
    data.members[0].name = anna.name;
    const benMember = withPerson(data, "Ben Friend");
    const ben: SessionUser = { ...benMember, email: benMember.email! };
    const task = withTask(data, "Talked about", { Status: "Todo" });
    const server = serving(data, ben);
    server.comment(task, "Anna says hello", { ...anna, kind: "human" });
    server.comment(task, "Ben says hi", benMember);

    /* Ben is a member: his own comment has a ✕, Anna's has none. */
    data.project.role = "member";
    const first = await draw(data, task, server, ben);
    const annas = byTestId("comment").nth(0);
    const bens = byTestId("comment").nth(1);
    await expect.element(bens.getByRole("button", { name: "Delete comment" })).toBeVisible();
    expect(annas.getByRole("button", { name: /^Delete/ }).elements()).toHaveLength(0);

    /* His own delete asks too, and Cancel keeps the words. */
    await bens.getByRole("button", { name: "Delete comment" }).click();
    await expect
      .element(
        bens.getByRole("alertdialog", {
          name: "Delete this comment? Its words are gone for good.",
        }),
      )
      .toBeVisible();
    await bens.getByRole("button", { name: "Cancel" }).click();
    await expect.element(bens.getByTestId("comment-markdown")).toHaveTextContent("Ben says hi");
    await first.screen.unmount();

    /* Made an admin, Ben sees a ✕ on Anna's comment. */
    data.project.role = "admin";
    const { sent } = await draw(data, task, server, ben);
    const remove = annas.getByRole("button", { name: "Delete Anna Owner's comment" });
    await expect.element(remove).toBeVisible();

    /* The ✕ asks, naming the author, and deletes nothing until answered. */
    await remove.click();
    const ask = annas.getByRole("alertdialog", {
      name: "Delete Anna Owner's comment? Its words are gone for good.",
    });
    await expect.element(ask).toBeVisible();
    await annas.getByRole("button", { name: "Cancel" }).click();
    await expect.element(ask).not.toBeInTheDocument();
    await expect
      .element(annas.getByTestId("comment-markdown"))
      .toHaveTextContent("Anna says hello");
    expect(sent("DELETE", COMMENT)).toEqual([]);

    await remove.click();
    await annas.getByRole("button", { name: "Yes, delete" }).click();
    await expect.poll(() => sent("DELETE", COMMENT).length).toBe(1);
    await expect.poll(() => byTestId("comment").elements().length).toBe(1);
    await expect.element(byTestId("comment-markdown")).toHaveTextContent("Ben says hi");
  });
});
