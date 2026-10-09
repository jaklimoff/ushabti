import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { BoardShell } from "@/components/board/BoardApp";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { PropertiesPanel } from "./PropertiesPanel";

/*
 * What the screen does with a name that is taken, and with a list of options
 * that is too long. Each test here was a test of `e2e/option-names.spec.ts`,
 * and its name is the name it had there. The server's answers (409 and 400)
 * and what it kept are in `option-names-route.test.ts`; the race of four
 * creates at once stayed end to end, because it needs the real database.
 */

const POST_OPTION = /^\/api\/properties\/[0-9a-f-]+\/options$/;
const PROPERTIES = /^\/api\/projects\/[0-9a-f-]+\/properties$/;

describe("One name, one option", () => {
  test("the menu says why when the name was taken somewhere else", async () => {
    const data = newProject();
    const task = withTask(data, "Write the notes", { Status: "Todo" });
    const server = serving(data);
    // Somebody else made it a moment ago, and this tab has not heard yet.
    const answer: typeof server.answer = (sent) =>
      sent.method === "POST" && POST_OPTION.test(sent.path)
        ? { status: 409, body: { error: "Status already has an option named parked." } }
        : server.answer(sent);
    await renderWithBoard(<BoardShell initialTask={task.key} />, data, answer);

    const field = () =>
      page.elementLocator(
        document.querySelector('[data-testid="task-panel"] [data-property="Status"]')!,
      );
    await field().getByRole("button", { name: "Todo" }).click();
    const box = field().getByLabelText("Find or add status");
    await box.fill("Parked");
    await expect.element(field().getByRole("option", { name: "Add “Parked”" })).toBeVisible();

    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByTestId("toast"))
      .toHaveTextContent("Status already has an option named parked.");
  });

  test("the box takes one option per line, says the limit and sends nothing", async () => {
    const data = newProject();
    const { sent } = await renderWithBoard(<PropertiesPanel />, data);

    const box = page.getByLabelText("Options of the new property");
    await page.getByLabelText("New property name").fill("Stickers");
    await box.fill(Array.from({ length: 60 }, (_, i) => `Label ${i + 1}`).join("\n"));
    await expect
      .element(page.getByRole("alert").filter({ hasText: "A property holds at most 40 options." }))
      .toHaveTextContent("A property holds at most 40 options. This list has 60.");
    await expect.element(page.getByRole("button", { name: "Add property" })).toBeDisabled();
    expect(sent("POST", PROPERTIES)).toHaveLength(0);

    // Back under the limit, the list goes out as it was typed: one option a line.
    await page.getByLabelText("New property name").fill("Size");
    await box.fill("Small, but not tiny\nLarge");
    await page.getByRole("button", { name: "Add property" }).click();
    await expect.poll(() => sent("POST", PROPERTIES).length).toBe(1);
    expect(sent("POST", PROPERTIES)[0].body).toEqual({
      name: "Size",
      type: "select",
      options: ["Small, but not tiny", "Large"],
    });
  });
});
