import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { BoardData } from "@/lib/types";
import {
  newProject,
  optionOf,
  propertyOf,
  renderWithBoard,
  type Answer,
  type Sent,
} from "@/test/board";
import { useBoard } from "@/components/board/store";
import { Toasts } from "@/components/ui/Toasts";
import { PropertiesPanel } from "./PropertiesPanel";

/*
 * The plan of an option in Settings: the start, the target, the note and the
 * shipped date. Each test here was a test of `e2e/option-dates.spec.ts`, and
 * its name is the name it had there. What the boxes send is checked here;
 * what the server keeps, and who may write it, is `option-dates-route.test.ts`.
 */

const OPTION = /^\/api\/options\/[0-9a-f-]+$/;

/** Settings draws the boxes only on a property that says its options carry dates. */
function dated(data: BoardData, name = "Status") {
  propertyOf(data, name).config = { dated: true };
}

function option(data: BoardData, name: string) {
  const id = optionOf(data, "Status", name);
  return propertyOf(data, "Status").options.find((o) => o.id === id)!;
}

/* The toasts are the shell's, and the panel alone has none to draw them. */
function Shown() {
  const { toasts } = useBoard();
  return <Toasts toasts={toasts} />;
}

/** The server as far as these tests need it: it keeps a patch, and refuses a target before the start. */
function keeping(data: BoardData): Answer {
  return ({ method, path, body }) => {
    if (method !== "PATCH" || !OPTION.test(path)) return;
    const found = propertyOf(data, "Status").options.find((o) => path.endsWith(o.id));
    if (!found) return;
    const patch = body as Record<string, string | null>;
    const start = patch.startAt ?? found.startAt;
    const target = patch.targetAt ?? found.targetAt;
    if (start && target && target < start) {
      return { status: 400, body: { error: "The target date cannot be before the start date." } };
    }
    Object.assign(found, patch);
    return { body: {} };
  };
}

async function draw(data: BoardData, answer: Answer = keeping(data)) {
  return renderWithBoard(
    <>
      <PropertiesPanel />
      <Shown />
    </>,
    data,
    answer,
  );
}

const writes = (sent: (m?: string, p?: RegExp) => Sent[]) => () => sent("PATCH", OPTION);
const box = (name: string) =>
  page.getByTestId("property-box").filter({
    has: page.getByLabelText(`Name of the ${name} property`),
  });

async function sentCount(patches: () => Sent[], count: number) {
  await expect.poll(() => patches().length).toBe(count);
}

/** The element of a locator, for the things a locator cannot say. */
const el = <T extends HTMLElement>(locator: { element(): Element }) => locator.element() as T;

describe("An option carries a plan", () => {
  test("a multi-select option does not get them", async () => {
    const data = newProject();
    dated(data);
    await draw(data);
    expect(
      box("Labels")
        .getByLabelText(/^Start of /)
        .elements(),
    ).toHaveLength(0);
    await expect
      .element(
        box("Status")
          .getByLabelText(/^Start of /)
          .first(),
      )
      .toBeVisible();
  });

  test("Settings saves the start, the target and the note on blur", async () => {
    const data = newProject();
    dated(data);
    const { sent } = await draw(data);
    const patches = writes(sent);
    const status = box("Status");

    for (const [label, day] of [
      ["Start of Todo", "2026-10-01"],
      ["Target of Todo", "2026-10-14"],
    ]) {
      await status.getByLabelText(label).fill(day);
      el<HTMLInputElement>(status.getByLabelText(label)).blur();
    }
    const note = status.getByLabelText("Note of Todo");
    await note.fill("Ships the API");
    el<HTMLTextAreaElement>(note).blur();
    await sentCount(patches, 3);
    expect(patches().map((s) => s.body)).toEqual([
      { startAt: "2026-10-01" },
      { targetAt: "2026-10-14" },
      { note: "Ships the API" },
    ]);

    // A target before the start is refused, and the box goes back.
    const target = status.getByLabelText("Target of Todo");
    await target.fill("2026-09-01");
    el<HTMLInputElement>(target).blur();
    await expect
      .poll(() => page.getByTestId("toast").query()?.textContent)
      .toContain("cannot be before the start date");
    await expect.element(target).toHaveValue("2026-10-14");

    // Emptied, the note is taken away.
    await note.fill("");
    el<HTMLTextAreaElement>(note).blur();
    await expect.poll(() => patches().at(-1)?.body).toEqual({ note: null });
  });

  test("a date box with one part cleared keeps the saved date", async () => {
    const data = newProject();
    dated(data);
    option(data, "Todo").startAt = "2026-10-01";
    const { sent } = await draw(data);
    const patches = writes(sent);
    const start = box("Status").getByLabelText("Start of Todo");
    await expect.element(start).toHaveValue("2026-10-01");

    // One part cleared: the box answers "" although the day is only half
    // gone. That is not an empty box, so nothing is written.
    el<HTMLInputElement>(start).focus();
    await userEvent.keyboard("{Backspace}");
    expect(el<HTMLInputElement>(start).validity.badInput).toBe(true);
    el<HTMLInputElement>(start).blur();
    await expect.element(start).toHaveValue("2026-10-01");

    // Nor when the tab goes with the box half cleared.
    el<HTMLInputElement>(start).focus();
    await userEvent.keyboard("{Backspace}");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(patches()).toHaveLength(0);
  });

  test("a note of many lines keeps its lines through a focus and a blur", async () => {
    const data = newProject();
    dated(data);
    const words = "Scope:\n- API\n- UI";
    option(data, "Todo").note = words;
    const { sent } = await draw(data);
    const patches = writes(sent);
    const note = box("Status").getByLabelText("Note of Todo");
    await expect.element(note).toHaveValue(words);

    // A focus and a blur that changed nothing send nothing.
    el<HTMLTextAreaElement>(note).focus();
    el<HTMLTextAreaElement>(note).blur();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(patches()).toHaveLength(0);

    // Shift+Enter makes a line, so a person can write one too.
    el<HTMLTextAreaElement>(note).focus();
    el<HTMLTextAreaElement>(note).setSelectionRange(words.length, words.length);
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await userEvent.keyboard("- Docs");
    el<HTMLTextAreaElement>(note).blur();
    await sentCount(patches, 1);
    expect(patches()[0].body).toEqual({ note: `${words}\n- Docs` });
  });

  for (const [label, field, words] of [
    ["Start", "startAt", "2026-10-01"],
    ["Target", "targetAt", "2026-10-14"],
    ["Note", "note", "Half typed"],
  ] as const) {
    test(`a ${label.toLowerCase()} still in its box is sent when the tab goes`, async () => {
      const data = newProject();
      dated(data);
      const { sent } = await draw(data);
      const patches = writes(sent);
      const inBox = box("Status").getByLabelText(`${label} of In Progress`);
      await inBox.fill(words);
      expect(document.activeElement).toBe(inBox.element());

      // A closed tab raises pagehide and no blur.
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
      await sentCount(patches, 1);
      expect(patches()[0].body).toEqual({ [field]: words });
    });
  }

  test("the shipped date is read only, with one Unship", async () => {
    const data = newProject();
    dated(data);
    option(data, "Ready").shippedAt = "2026-10-02";
    const { sent } = await draw(data);
    const patches = writes(sent);
    const status = box("Status");
    await expect.element(status.getByText("Shipped 2026-10-02")).toBeVisible();
    expect(status.getByRole("button", { name: /^Unship / }).elements()).toHaveLength(1);
    // Shown, never typed into: there is no box for it.
    expect(status.getByLabelText(/^Shipped of /).elements()).toHaveLength(0);

    // The day it shipped cannot be typed back, so the row asks first.
    await status.getByRole("button", { name: "Unship Ready" }).click();
    await expect
      .poll(() => status.getByRole("alertdialog").query()?.textContent)
      .toContain("Unship Ready?");
    await status.getByRole("button", { name: "Cancel" }).click();
    await expect.element(status.getByText("Shipped 2026-10-02")).toBeVisible();
    expect(patches()).toHaveLength(0);

    await status.getByRole("button", { name: "Unship Ready" }).click();
    await status.getByRole("button", { name: "Yes, unship" }).click();
    await sentCount(patches, 1);
    expect(patches()[0].body).toEqual({ shippedAt: null });
    expect(status.getByText("Shipped 2026-10-02").elements()).toHaveLength(0);
    expect(status.getByRole("button", { name: /^Unship / }).elements()).toHaveLength(0);
  });

  test("no switch says it; a select dated before keeps its boxes", async () => {
    const plain = newProject();
    option(plain, "Todo").startAt = "2026-10-01";
    await draw(plain);
    const status = box("Status");
    // A new plain select has no dates, and nothing on the page offers them.
    expect(page.getByText("Options carry dates").elements()).toHaveLength(0);
    expect(status.getByLabelText(/^Start of /).elements()).toHaveLength(0);
    expect(status.getByLabelText(/^Note of /).elements()).toHaveLength(0);
    expect(status.getByRole("button", { name: /^Unship / }).elements()).toHaveLength(0);
  });

  // Was the second half of the test above: the stored flag is what draws the boxes.
  test("a select dated before keeps its boxes by the stored flag", async () => {
    const data = newProject();
    dated(data);
    const todo = option(data, "Todo");
    todo.startAt = "2026-10-01";
    todo.shippedAt = "2026-10-02";
    await draw(data);
    const status = box("Status");
    await expect.element(status.getByLabelText("Start of Todo")).toHaveValue("2026-10-01");
    await expect.element(status.getByLabelText("Target of Todo")).toBeVisible();
    await expect.element(status.getByLabelText("Note of Todo")).toBeVisible();
    await expect.element(status.getByRole("button", { name: "Unship Todo" })).toBeVisible();
    expect(page.getByText("Options carry dates").elements()).toHaveLength(0);
  });

  // The member's half of "only an admin, and only a person, writes the shipped date".
  test("Settings shows a member the shipped date, and no Unship it would be refused", async () => {
    const data = newProject();
    dated(data);
    data.project.role = "member";
    option(data, "Ready").shippedAt = "2026-10-03";
    await draw(data);
    const status = box("Status");
    await expect.element(status.getByText("Shipped 2026-10-03")).toBeVisible();
    expect(status.getByRole("button", { name: /^Unship / }).elements()).toHaveLength(0);
  });
});
