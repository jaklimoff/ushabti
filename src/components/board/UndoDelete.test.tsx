import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { Archive } from "@/components/archive/Archive";
import type { BoardData, DeletedTaskDTO } from "@/lib/types";
import { ME, newProject, renderWithBoard, withTask, type Answer } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * Three tests that came from `e2e/undo-delete.spec.ts`. Each keeps the name it
 * had there. A reload there is the fake server's copy read here.
 */

const TASK = /^\/api\/tasks\/[0-9a-f-]+$/;
const RESTORE = /^\/api\/tasks\/([0-9a-f-]+)\/restore$/;

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });

afterEach(async () => {
  await page.viewport(1440, 900);
  vi.restoreAllMocks();
});

/** The fake server, with a delete that keeps the row and a restore that puts
    it back, so the refresh after Undo draws it where it was. */
function deleting(data: BoardData) {
  const fake = serving(data, ME);
  const gone = new Map<string, BoardData["tasks"][number]>();
  const answer: Answer = (sent) => {
    const id = TASK.test(sent.path) ? sent.path.split("/").pop()! : null;
    if (sent.method === "DELETE" && id) {
      const task = fake.server.tasks.find((t) => t.id === id)!;
      gone.set(id, task);
      fake.server.tasks = fake.server.tasks.filter((t) => t !== task);
      const goesAt = new Date(Date.now() + 30 * 86_400_000 - 60_000).toISOString();
      return { body: { ok: true, goesAt } };
    }
    const back = RESTORE.exec(sent.path);
    if (sent.method === "POST" && back) {
      fake.server.tasks.push(gone.get(back[1])!);
      gone.delete(back[1]);
      return { body: { ok: true } };
    }
    return fake.answer(sent);
  };
  return { ...fake, answer };
}

async function draw(data: BoardData, open: string | null) {
  const fake = deleting(data);
  const drawn = await renderWithBoard(<BoardShell initialTask={open} />, data, fake.answer);
  return { ...drawn, fake };
}

/** Deletes the task whose panel is open, from the panel menu. */
async function deleteOpenTask(sent: (m: string, p: RegExp) => unknown[]) {
  await page.getByRole("button", { name: "Task menu" }).click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await expect.poll(() => sent("DELETE", TASK).length).toBe(1);
}

/** The element's words hold `text`. `toHaveTextContent` asks for all of them. */
const says = (locator: Locator, text: string) =>
  expect.poll(() => locator.element().textContent ?? "").toContain(text);

const titles = () =>
  byTestId("card")
    .elements()
    .map((el) => el.textContent ?? "");

describe("Undoing a delete", () => {
  test("Undo in the toast puts the task back where it was", async () => {
    const data = newProject();
    for (const title of ["First of three", "Second of three", "Third of three"])
      withTask(data, title, { Status: "Todo" });
    const second = data.tasks.find((t) => t.title === "Second of three")!;
    const { sent } = await draw(data, null);
    const before = titles();
    expect(before).toHaveLength(3);

    await card("Second of three").first().click();
    const key = second.key;
    await deleteOpenTask(sent);

    const toast = byTestId("toast");
    const undo = toast.getByRole("button", { name: "Undo" });
    await expect.element(undo).toBeVisible();
    // Archived is still named, for the moment the toast has gone.
    await says(toast, `${key} deleted. It stays under Archived for 30 days.`);
    // A toast that arrives never takes the focus from the board.
    expect(document.activeElement).not.toBe(undo.element());
    await expect.element(card("Second of three")).not.toBeInTheDocument();

    await undo.click();
    await expect.poll(() => sent("POST", RESTORE).length).toBe(1);
    await expect.element(toast).not.toBeInTheDocument();
    await expect.poll(titles).toEqual(before);
  });

  test("Undo is reached by the keyboard and waits while it has the focus", async () => {
    const data = newProject();
    withTask(data, "Undone by a key", { Status: "Todo" });
    /* The toast lives ten seconds. The timer is caught and fired by hand, so
       the test does not sit through them. */
    const real = globalThis.setTimeout;
    const lapses: (() => void)[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 10000) {
        lapses.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return real(fn, ms);
    }) as typeof setTimeout);
    const { sent } = await draw(data, null);

    await card("Undone by a key").first().click();
    await deleteOpenTask(sent);

    const undo = byTestId("toast").getByRole("button", { name: "Undo" });
    await expect.element(undo).toBeVisible();
    expect(document.activeElement).not.toBe(undo.element());
    await userEvent.keyboard("{Tab}");
    await expect.poll(() => document.activeElement).toBe(undo.element());

    // Longer than any toast lives: a focused button must not vanish.
    expect(lapses).toHaveLength(1);
    lapses.forEach((fn) => fn());
    await expect.element(undo).toBeVisible();
    expect(document.activeElement).toBe(undo.element());

    await userEvent.keyboard("{Enter}");
    await expect.poll(() => sent("POST", RESTORE).length).toBe(1);
    await expect.element(byTestId("toast")).not.toBeInTheDocument();
    await expect.element(card("Undone by a key").first()).toBeVisible();
  });
});

describe("The drawer on a phone", () => {
  test("both lists fit the screen, and every way back is pressable", async () => {
    await page.viewport(390, 780);
    const data = newProject();
    const short = withTask(data, "A short one", { Status: "Todo" });
    const long = withTask(data, "A title long enough to need the whole of a small screen", {
      Status: "Todo",
    });
    const { sent } = await draw(data, long.key);
    void short;

    await deleteOpenTask(sent);
    const undo = byTestId("toast").getByRole("button", { name: "Undo" });
    await expect.element(undo).toBeVisible();
    const fits = (el: Element) => {
      const box = el.getBoundingClientRect();
      expect(box.width, `Undo is ${box.width} px wide`).toBeGreaterThanOrEqual(24);
      expect(box.height, `Undo is ${box.height} px tall`).toBeGreaterThanOrEqual(24);
    };
    fits(undo.element());

    // The archive page: one archived row, one deleted row.
    const board = newProject();
    const archived = withTask(board, "A short one", { Status: "Todo" });
    board.tasks = board.tasks.filter((t) => t.id !== archived.id);
    board.archived.push({
      id: archived.id,
      number: archived.number,
      key: archived.key,
      title: archived.title,
      description: archived.description,
      position: archived.position,
      archivedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const now = Date.now();
    const deleted: DeletedTaskDTO[] = [
      {
        id: "00000000-0000-4000-8000-000000000042",
        number: 42,
        key: `${archived.key.split("-")[0]}-42`,
        title: "A title long enough to need the whole of a small screen",
        position: "a1",
        deletedAt: new Date(now - 60_000).toISOString(),
        goesAt: new Date(now + 30 * 86_400_000 - 60_000).toISOString(),
      },
    ];
    const { cleanup } = await import("vitest-browser-react");
    await cleanup();
    await renderWithBoard(<Archive initial={board} deleted={deleted} user={ME} />, board);

    await expect.poll(() => byTestId("archive-row").elements().length).toBe(1);
    await expect.poll(() => byTestId("deleted-row").elements().length).toBe(1);
    await says(byTestId("deleted-row"), "30 days left");

    const doc = document.documentElement;
    expect(Math.max(doc.scrollWidth - doc.clientWidth, 0)).toBe(0);

    const buttons = page.getByRole("button", { name: /^Put .* back$/ }).elements();
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      expect(box.width, `${button.ariaLabel} is ${box.width} px wide`).toBeGreaterThanOrEqual(24);
      expect(box.height, `${button.ariaLabel} is ${box.height} px tall`).toBeGreaterThanOrEqual(24);
    }
  });
});
