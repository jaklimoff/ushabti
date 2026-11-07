import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { fillBox, serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * A press outside the panel puts it away. The close used to unmount the panel
 * before the press moved the focus, and a removed box raises no blur, so what
 * the box was typing was lost. Now the box is blurred first and saves as its
 * blur would.
 */

const TASK = /^\/api\/tasks\/[0-9a-f-]+$/;
const ITEM = /^\/api\/checklist\/[0-9a-f-]+$/;
const CHECKLIST = /^\/api\/tasks\/[0-9a-f-]+\/checklist$/;
const VALUE = /^\/api\/tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+$/;
const byTestId = (id: string) => page.getByTestId(id);

async function opened() {
  const data = newProject();
  data.properties.push({
    id: crypto.randomUUID(),
    name: "Points",
    type: "number",
    position: "z",
    config: {},
    options: [],
  });
  const task = withTask(data, "Old title", { Status: "Todo" });
  const server = serving(data);
  const drawn = await renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer);
  await expect.element(byTestId("task-panel")).toBeVisible();
  return { ...drawn, ...server, task };
}

/** A press on an empty spot of the board, left of the panel. */
async function pressBoard() {
  const canvas = byTestId("board-canvas");
  const box = canvas.element().getBoundingClientRect();
  await canvas.click({ position: { x: 8, y: box.height - 8 } });
  await expect.element(byTestId("task-panel")).not.toBeInTheDocument();
}

describe("A press on the board keeps what the panel was typing", () => {
  test("the title is saved", async () => {
    const { sent } = await opened();
    await byTestId("task-title").fill("New title");
    await pressBoard();
    await expect.poll(() => sent("PATCH", TASK).length).toBe(1);
    expect(sent("PATCH", TASK)[0].body).toMatchObject({ title: "New title" });
  });

  test("the description is saved", async () => {
    const { sent } = await opened();
    await page.getByText("Add a description…").click();
    await fillBox("Typed and pressed away.");
    await pressBoard();
    await expect.poll(() => sent("PATCH", TASK).length).toBe(1);
    expect(sent("PATCH", TASK)[0].body).toMatchObject({
      description: "Typed and pressed away.",
      baseDescription: "",
    });
  });

  test("an edited checklist item is saved", async () => {
    const { sent, item, ring, task } = await opened();
    item(task, "First step");
    ring();
    await page.getByText("First step").click();
    await expect.poll(() => (document.activeElement as HTMLInputElement).value).toBe("First step");
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}Second step");
    await pressBoard();
    await expect.poll(() => sent("PATCH", ITEM).length).toBe(1);
    expect(sent("PATCH", ITEM)[0].body).toEqual({ text: "Second step", baseText: "First step" });
  });

  test("a new checklist item is saved", async () => {
    const { sent } = await opened();
    await page.getByRole("button", { name: "Add item" }).click();
    await userEvent.keyboard("A new step");
    await pressBoard();
    await expect.poll(() => sent("POST", CHECKLIST).length).toBe(1);
    expect(sent("POST", CHECKLIST)[0].body).toEqual({ text: "A new step" });
  });

  test("a property value box is saved", async () => {
    const { sent } = await opened();
    await page.getByRole("textbox", { name: "Points" }).fill("5");
    await pressBoard();
    await expect.poll(() => sent("PUT", VALUE).length + sent("PATCH", VALUE).length).toBe(1);
    const [write] = [...sent("PUT", VALUE), ...sent("PATCH", VALUE)];
    expect(write.body).toMatchObject({ value: 5 });
  });

  test("a box only focused, or thrown back with Escape, sends nothing", async () => {
    const { sent } = await opened();
    await byTestId("task-title").click();
    await pressBoard();
    await page.getByText("Old title").click();
    await expect.element(byTestId("task-panel")).toBeVisible();

    const points = page.getByRole("textbox", { name: "Points" });
    await points.fill("7");
    await userEvent.keyboard("{Escape}");
    await points.click();
    await pressBoard();

    await new Promise((r) => setTimeout(r, 100));
    expect(sent("PATCH", TASK)).toHaveLength(0);
    expect(sent("PUT", VALUE)).toHaveLength(0);
    expect(sent("PATCH", VALUE)).toHaveLength(0);
  });
});
