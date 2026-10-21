import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { BoardData } from "@/lib/types";
import { newProject, renderWithBoard, withPhases } from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * The "⋯" beside the open view's pill: a menu that renames the view, groups
 * it, opens its card, copies its link, and makes it main or deletes it. The
 * writes are the Views page's own, so the tests read what went out.
 */

const VIEW = /^\/api\/views\/[0-9a-f-]+$/;

function draw(data: BoardData) {
  return renderWithBoard(<BoardShell initialTask={null} />, data);
}

const pill = (name: string) => page.getByTestId("view-pill").filter({ hasText: name });
const more = (name: string) => page.getByRole("button", { name: `More for ${name}` });
const menu = (name: string) => page.getByRole("menu", { name: `More for ${name}` });
const item = (name: string) => page.getByRole("menuitem", { name, exact: true });
const words = () =>
  [...document.querySelectorAll("[role=menu] [role=menuitem]")].map((el) => el.textContent?.trim());

async function openMenu(name: string) {
  await pill(name).click();
  await expect.element(pill(name)).toHaveAttribute("aria-current", "true");
  await more(name).click();
  await expect.element(menu(name)).toBeVisible();
}

describe("The menu of the open view", () => {
  test("holds Rename, the columns, Card, Copy link, Make main and Delete", async () => {
    const data = withPhases(newProject());
    await draw(data);
    await openMenu("Phases");

    expect(words()).toEqual(["Rename", "Card", "Copy link", "Make main", "Delete"]);
    const columns = page.getByRole("group", { name: "Columns by" });
    await expect.element(columns).toBeVisible();
    await expect
      .element(columns.getByRole("menuitemradio", { name: "Phase" }))
      .toHaveAttribute("aria-checked", "true");
    // Only the open view carries one.
    expect(page.getByRole("button", { name: /^More for / }).elements()).toHaveLength(1);
  });

  test("picks the columns with the same write the Views page makes", async () => {
    const data = withPhases(newProject());
    const phases = data.views[1];
    const status = data.properties.find((p) => p.name === "Status")!;
    const { sent } = await draw(data);
    await openMenu("Phases");

    await page.getByRole("menuitemradio", { name: "Status" }).click();
    await expect.element(menu("Phases")).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(sent("PATCH", VIEW).map((s) => [s.path, s.body])).toEqual([
        [`/api/views/${phases.id}`, { groupById: status.id }],
      ]),
    );
  });

  test("a list has no columns to pick, and a roadmap no card", async () => {
    const data = withPhases(newProject());
    data.views[1] = { ...data.views[1], kind: "list", groupById: null };
    const first = await draw(data);
    await openMenu("Phases");
    await expect.element(page.getByRole("group", { name: "Columns by" })).not.toBeInTheDocument();
    expect(words()).toContain("Card");
    await first.screen.unmount();

    const road = withPhases(newProject());
    road.views[1] = { ...road.views[1], kind: "roadmap" };
    await draw(road);
    await openMenu("Phases");
    await expect.element(page.getByRole("group", { name: "Rows from" })).toBeVisible();
    expect(words()).not.toContain("Card");
  });

  test("Card opens the card panel", async () => {
    const data = withPhases(newProject());
    await draw(data);
    await openMenu("Phases");
    await item("Card").click();
    await expect.element(page.getByTestId("card-button")).toHaveAttribute("aria-expanded", "true");
  });

  test("works with the keyboard and hands the focus back to the pill", async () => {
    const data = withPhases(newProject());
    const phases = data.views[1];
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await draw(data);
    await pill("Phases").click();

    (pill("Phases").element() as HTMLElement).focus();
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(more("Phases").element());
    expect(more("Phases").element().getBoundingClientRect().width).toBeGreaterThan(0);

    await userEvent.keyboard("{Enter}");
    await expect.element(menu("Phases")).toBeVisible();
    expect(document.activeElement).toBe(item("Rename").element());
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(item("Delete").element());
    await userEvent.keyboard("{Escape}");
    await expect.element(menu("Phases")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(more("Phases").element());

    // Copy link is today's copy, reached by the arrows.
    await userEvent.keyboard("{Enter}");
    await expect.element(menu("Phases")).toBeVisible();
    await userEvent.keyboard("{End}{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(item("Copy link").element());
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByTestId("toast")).toHaveTextContent("Link copied");
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/p/${data.project.id}?view=${phases.id}`,
    );
    expect(document.activeElement).toBe(more("Phases").element());
    // The copy picked nothing and moved nothing.
    await expect.element(pill("Phases")).toHaveAttribute("aria-current", "true");
    writeText.mockRestore();
  });

  test("a pill is still picked with Space and Enter", async () => {
    const data = withPhases(newProject());
    await draw(data);
    (pill("Phases").element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await expect.element(pill("Phases")).toHaveAttribute("aria-current", "true");
    (pill("Board").element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(pill("Board")).toHaveAttribute("aria-current", "true");
    await expect.element(menu("Board")).not.toBeInTheDocument();
  });
});

describe("Renaming a view from its menu", () => {
  const box = () => page.getByRole("textbox", { name: "Name of the view Phases" });

  test("saves on Enter and hands the focus back to the pill", async () => {
    const data = withPhases(newProject());
    const phases = data.views[1];
    const { sent } = await draw(data);
    await openMenu("Phases");
    await item("Rename").click();

    await expect.element(box()).toHaveFocus();
    await box().fill("Stages");
    await userEvent.keyboard("{Enter}");
    await expect.element(pill("Stages")).toHaveFocus();
    expect(sent("PATCH", VIEW).map((s) => [s.path, s.body])).toEqual([
      [`/api/views/${phases.id}`, { name: "Stages" }],
    ]);
  });

  test("saves on blur", async () => {
    const data = withPhases(newProject());
    const phases = data.views[1];
    const { sent } = await draw(data);
    await openMenu("Phases");
    await item("Rename").click();

    await box().fill("By phase");
    (box().element() as HTMLElement).blur();
    await expect.element(pill("By phase")).toBeVisible();
    expect(sent("PATCH", VIEW).map((s) => [s.path, s.body])).toEqual([
      [`/api/views/${phases.id}`, { name: "By phase" }],
    ]);
  });

  test("a name typed and left without a blur still saves", async () => {
    const data = withPhases(newProject());
    const phases = data.views[1];
    const { sent } = await draw(data);
    await openMenu("Phases");
    await item("Rename").click();
    await box().fill("Stages");

    // The box still has the focus. A closed tab raises pagehide and no blur.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await vi.waitFor(() =>
      expect(sent("PATCH", VIEW).map((s) => [s.path, s.body])).toEqual([
        [`/api/views/${phases.id}`, { name: "Stages" }],
      ]),
    );
    const leave = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(leave?.[1]?.keepalive).toBe(true);
  });

  test("Escape puts the name back and writes nothing", async () => {
    const data = withPhases(newProject());
    const { sent } = await draw(data);
    await openMenu("Phases");
    await item("Rename").click();

    await box().fill("Something else");
    await userEvent.keyboard("{Escape}");
    await expect.element(pill("Phases")).toHaveFocus();
    expect(sent("PATCH", VIEW)).toEqual([]);
  });
});

describe("Make main and Delete", () => {
  test("show to an admin on a view that is not main, and Delete asks first", async () => {
    const data = withPhases(newProject());
    const phases = data.views[1];
    const { sent } = await draw(data);
    await openMenu("Phases");

    await item("Delete").click();
    const question = page.getByRole("alertdialog");
    await expect
      .element(question)
      .toHaveAccessibleName(
        "Delete the view Phases? The tasks stay; only this way of looking at them goes.",
      );
    expect(sent("DELETE", VIEW)).toEqual([]);

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(item("Delete")).toBeVisible();
    expect(sent("DELETE", VIEW)).toEqual([]);

    await item("Delete").click();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await expect.element(pill("Phases")).not.toBeInTheDocument();
    expect(sent("DELETE", VIEW).map((s) => s.path)).toEqual([`/api/views/${phases.id}`]);
  });

  test("Make main moves the word with the same write as the Views page", async () => {
    const data = withPhases(newProject());
    const phases = data.views[1];
    const { sent } = await draw(data);
    await openMenu("Phases");
    await item("Make main").click();
    await vi.waitFor(() =>
      expect(sent("PATCH", VIEW).map((s) => [s.path, s.body])).toEqual([
        [`/api/views/${phases.id}`, { isDefault: true }],
      ]),
    );
    // Now it is the main view, so neither is offered.
    await pill("Phases").hover();
    await more("Phases").click();
    expect(words()).toEqual(["Rename", "Card", "Copy link"]);
  });

  test("are not offered on the main view", async () => {
    const data = withPhases(newProject());
    await draw(data);
    await openMenu("Board");
    expect(words()).toEqual(["Rename", "Card", "Copy link"]);
  });

  test("are not offered to a member", async () => {
    const data = withPhases(newProject());
    data.project.role = "member";
    await draw(data);
    await openMenu("Phases");
    expect(words()).toEqual(["Rename", "Card", "Copy link"]);
  });
});
