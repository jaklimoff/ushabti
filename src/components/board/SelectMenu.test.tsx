import { describe, expect, test, vi } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import type { BoardData } from "@/lib/types";
import { newProject, optionOf, propertyOf, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * The menu of a select, on the panel and on the pick bar. Each test here was
 * a test of `e2e/select-menu.spec.ts`, and its name is the name it had there.
 * A reload there is the server's copy read here, and drawn again where the
 * spec looked at the screen.
 *
 * Status has five options with long names, so it is a menu rather than a row
 * of buttons. "re" matches two of them: In Progress and Ready. Enter used to
 * make a sixth option called "re", which is a column everybody sees.
 */

/** Any write to a task's values: one task, or the picked ones in one call. */
const WRITE =
  /^\/api\/(tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+|projects\/[0-9a-f-]+\/tasks\/values)$/;
const OPTIONS = /^\/api\/properties\/[0-9a-f-]+\/options$/;

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const column = (name: string) =>
  byTestId("column").filter({
    has: byTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });

/** One property's field on the task panel. A locator made from an element
    is made from what it draws now, so it is asked for afresh each time. */
const field = (name: string) =>
  page.elementLocator(
    document.querySelector(`[data-testid="task-panel"] [data-property="${name}"]`)!,
  );

/** The words of the row the keys are on, inside `within`. */
const atText = (within: Locator) =>
  within.element().querySelector('[data-at="true"]')?.textContent?.trim() ?? "";

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

async function draw(data: BoardData, open: string | null) {
  const server = serving(data);
  const drawn = await renderWithBoard(<BoardShell initialTask={open} />, data, server.answer);
  const writes = () => drawn.sent().filter((r) => r.method !== "GET" && WRITE.test(r.path));
  return { ...drawn, server: server.server, writes };
}

describe("The menu of a select", () => {
  test("Enter picks the highlighted match and makes nothing", async () => {
    const data = newProject();
    const task = withTask(data, "Write the notes", { Status: "Todo" });
    const { server, writes, sent } = await draw(data, task.key);
    const columns = byTestId("column").elements().length;

    const status = () => field("Status");
    await status().getByRole("button", { name: "Todo" }).click();
    const box = () => status().getByLabelText("Find or add status");
    await box().fill("re");

    /* Two matches, and an explicit row to make a new one after them. */
    await expect.poll(() => atText(status())).toMatch(/In Progress/);
    await expect.element(status().getByRole("option", { name: "Add “re”" })).toBeVisible();

    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => atText(status())).toMatch(/Ready/);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => writes().length).toBe(1);

    await expect.element(column("Ready").getByText("Write the notes")).toBeVisible();
    expect(byTestId("column").elements()).toHaveLength(columns);

    /* The name that is there is picked, and never offered again. */
    await status().getByRole("button", { name: "Ready" }).click();
    await box().fill("todo");
    await gone(status().getByRole("option", { name: /^Add/ }));
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => writes().length).toBe(2);
    await expect.element(column("Todo").getByText("Write the notes")).toBeVisible();

    /* A new option comes only from its own row, and Enter on it is a choice.
       The answer is held back, so a second Enter lands while the first is on
       its way: one Enter makes one option, however quick the hand. */
    await status().getByRole("button", { name: "Todo" }).click();
    await box().fill("Blocked");
    await expect.poll(() => atText(status())).toBe("Add “Blocked”");
    const answer = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && OPTIONS.test(new URL(String(input), location.origin).pathname))
        await new Promise((done) => setTimeout(done, 600));
      return answer(input, init);
    });
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    await expect.element(column("Blocked").getByText("Write the notes")).toBeVisible();

    /* What a reload reads: one option made, and the task in it. */
    expect(sent("POST", OPTIONS)).toHaveLength(1);
    const statusId = propertyOf(data, "Status").id;
    const made = server.properties.find((p) => p.id === statusId)!.options;
    expect(made.map((o) => o.name)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "Ready",
      "Shipped",
      "Blocked",
    ]);
    expect(server.tasks[0].values[statusId]).toBe(made[5].id);
    expect(byTestId("column").elements()).toHaveLength(columns + 1);
  });

  /* Labels is a multi-select: its menu stays open to take a second option.
     "u" matches bug, feature and ux. */
  test("a multi-select walks, stays open, and keeps the box", async () => {
    const data = newProject();
    const task = withTask(data, "Tidy the header", { Status: "Todo" });
    const first = await draw(data, task.key);

    const labels = () => field("Labels");
    await labels().getByRole("button", { name: "+ labels" }).click();
    const box = () => labels().getByLabelText("Find or add labels");
    await box().fill("u");
    await expect.poll(() => atText(labels())).toMatch(/bug/);
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => atText(labels())).toMatch(/ux/);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => first.writes().length).toBe(1);

    /* It stays open, on the row it just toggled, and the box is cleared. */
    const list = () => labels().getByRole("listbox");
    await expect.element(list()).toBeVisible();
    await expect.element(box()).toHaveValue("");
    await expect.poll(() => atText(labels())).toMatch(/ux/);
    await expect
      .element(list().getByRole("option", { name: "ux" }))
      .toHaveAttribute("aria-selected", "true");

    /* A press on a row leaves the focus in the box, so the keys still walk. */
    await list().getByRole("option", { name: "bug" }).click();
    await expect.poll(() => first.writes().length).toBe(2);
    await expect.element(box()).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => atText(labels())).toMatch(/feature/);
    const at = labels().element().querySelector('[data-at="true"]')!;
    await expect.element(box()).toHaveAttribute("aria-activedescendant", at.id);

    /* Drawn again from what the server holds, as the spec's reload was. */
    const labelsId = propertyOf(data, "Labels").id;
    expect(new Set(first.server.tasks[0].values[labelsId] as string[])).toEqual(
      new Set([optionOf(data, "Labels", "ux"), optionOf(data, "Labels", "bug")]),
    );
    await first.screen.unmount();
    await draw(first.server, null);
    await card("Tidy the header").click();
    const again = () => field("Labels");
    await expect.element(again().getByText("ux")).toBeVisible();
    await expect.element(again().getByText("bug")).toBeVisible();
    await again().getByRole("button", { name: "+ labels" }).click();
    await expect.poll(() => again().getByRole("option").elements().length).toBe(5);
    await gone(again().getByRole("option", { name: "u", exact: true }));
  });

  test("walks the same way for the picked cards", async () => {
    const data = newProject();
    for (const title of ["Aardvark", "Beetle"]) withTask(data, title, { Status: "Todo" });
    const { server, writes } = await draw(data, null);
    const columns = byTestId("column").elements().length;

    for (const title of ["Aardvark", "Beetle"]) {
      await card(title).getByTestId("card-pick").click();
    }
    await byTestId("pick-set").click();
    await byTestId("pick-search").fill("Status");
    await userEvent.keyboard("{Enter}");

    const menu = byTestId("pick-menu");
    await menu.getByRole("button", { name: "No status" }).first().click();
    const box = menu.getByLabelText("Find or add status");
    await box.fill("re");
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => atText(menu)).toMatch(/Ready/);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => writes().length).toBe(1);
    await userEvent.keyboard("{Escape}");

    /* What a reload reads: both in Ready, and no option made. */
    const statusId = propertyOf(data, "Status").id;
    const ready = optionOf(data, "Status", "Ready");
    expect(server.tasks.map((t) => t.values[statusId])).toEqual([ready, ready]);
    expect(server.properties.find((p) => p.id === statusId)!.options).toHaveLength(5);
    await expect.poll(() => column("Ready").getByTestId("card").elements().length).toBe(2);
    expect(byTestId("column").elements()).toHaveLength(columns);
  });
});
