import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { newProject, renderWithBoard } from "@/test/board";
import { ProjectPanel } from "./ProjectPanel";
import { PropertiesPanel } from "./PropertiesPanel";

/*
 * A settings select is the app's own menu, not the browser's. Each test here
 * was a test of `e2e/settings-select.spec.ts`, and its name is the name it
 * had there.
 */

/** What a token on :root holds, as the page computes it. */
function token(name: string) {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const said = getComputedStyle(probe).color;
  probe.remove();
  return said;
}

/** Whether every option is drawn where a click would land on it. */
function nothingCut(menu: Element) {
  const rows = [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
  menu.scrollTop = 0;
  const box = menu.getBoundingClientRect();
  const inWindow =
    box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth;
  const first = rows[0].getBoundingClientRect();
  const hit = document.elementFromPoint(first.left + 4, first.top + first.height / 2);
  return inWindow && !!hit && rows[0].contains(hit);
}

const list = () => page.getByRole("listbox");
const typeOfNew = () => page.getByLabelText("Type of the new property");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The words of the row the keys are on. */
function at(select: Locator) {
  const id = select.element().getAttribute("aria-activedescendant");
  return document.getElementById(id ?? "")?.textContent ?? "";
}

async function closed(select: Locator) {
  await expect.element(list()).not.toBeInTheDocument();
  await expect.element(select).toHaveAttribute("aria-expanded", "false");
}

afterEach(() => page.viewport(1440, 900));

describe("A settings select is the app's own menu", () => {
  test("a 28 px button with the value and a chevron, opening the board's menu", async () => {
    await renderWithBoard(<ProjectPanel files={false} />, newProject());

    const done = page.getByLabelText("The property that says a task is done");
    const progress = page.getByLabelText("Count progress by");
    await expect.element(done).toBeVisible();
    expect(done.element().tagName).toBe("BUTTON");
    expect(document.querySelectorAll("select")).toHaveLength(0);
    await expect.element(done).toHaveAttribute("role", "combobox");
    expect(done.element().textContent).toMatch(/Archived only/);
    expect(done.element().getBoundingClientRect().height).toBe(28);

    /* Two selects in one card line up, however short their words. */
    expect(progress.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(120);
    expect(done.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(120);

    await done.click();
    await expect.element(done).toHaveAttribute("aria-expanded", "true");
    await expect.element(list()).toBeVisible();
    expect(getComputedStyle(list().element()).backgroundColor).toBe(token("--bg-menu"));
    await expect
      .element(list().getByRole("option", { name: /Archived only/ }))
      .toHaveAttribute("aria-selected", "true");

    /* A click outside closes it. */
    await page.getByRole("heading", { name: "Project" }).click();
    await closed(done);
  });

  test("the keys open it, walk it, pick, close it and jump by letter", async () => {
    await renderWithBoard(<PropertiesPanel />, newProject());
    const type = typeOfNew();
    await expect.element(type).toHaveAttribute("data-value", "select");
    (type.element() as HTMLElement).focus();

    /* Enter opens on the current value. */
    await userEvent.keyboard("{Enter}");
    await expect.element(type).toHaveAttribute("aria-expanded", "true");
    expect(at(type)).toMatch(/^Select/);

    /* Down and Up move the highlight; Enter picks it. */
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(at(type)).toMatch(/^Sprint/);
    await userEvent.keyboard("{ArrowUp}");
    expect(at(type)).toMatch(/^Multi-select/);
    await userEvent.keyboard("{Enter}");
    await expect.element(list()).not.toBeInTheDocument();
    await expect.element(type).toHaveAttribute("data-value", "multi_select");
    await expect.element(type).toHaveFocus();

    /* Esc closes without picking and leaves the keys on the button. */
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(list()).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{Escape}");
    await expect.element(list()).not.toBeInTheDocument();
    await expect.element(type).toHaveFocus();
    await expect.element(type).toHaveAttribute("data-value", "multi_select");

    /* A letter jumps to the first option it starts. */
    await userEvent.keyboard(" ");
    await expect.element(list()).toBeVisible();
    await userEvent.keyboard("n");
    expect(at(type)).toMatch(/^Number/);
    await userEvent.keyboard("{Enter}");
    await expect.element(type).toHaveAttribute("data-value", "number");

    /* A click picks as well. */
    await type.click();
    await page.getByRole("option", { name: "Link", exact: true }).click();
    await expect.element(type).toHaveAttribute("data-value", "link");
    expect(type.element().textContent).toMatch(/Link/);
  });

  test("the menu is not cut by the card or the bottom of the window", async () => {
    await page.viewport(900, 420);
    await renderWithBoard(<PropertiesPanel />, newProject());
    const type = typeOfNew();
    await expect.element(type).toBeVisible();
    /* Put the button near the bottom of the window. */
    type.element().scrollIntoView();
    const near = type.element().getBoundingClientRect();
    document.scrollingElement!.scrollTop += near.bottom - innerHeight + 40;

    await type.click();
    await expect.element(list()).toBeVisible();
    expect(nothingCut(list().element())).toBe(true);
    const menu = list().element().getBoundingClientRect();
    const button = type.element().getBoundingClientRect();
    expect(menu.y + menu.height).toBeLessThanOrEqual(button.y);
  });

  test("a menu taller than its room scrolls, and stays where it is scrolled", async () => {
    await page.viewport(900, 260);
    await renderWithBoard(<PropertiesPanel />, newProject());
    const type = typeOfNew();
    await expect.element(type).toBeVisible();
    /* Put the button in the middle, so neither side holds the whole menu. */
    type.element().scrollIntoView();
    const middle = type.element().getBoundingClientRect();
    document.scrollingElement!.scrollTop += middle.top - innerHeight / 2;
    /* Opened by key, so the highlight sits on the first row and no pointer
       moves it. */
    (type.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(list()).toBeVisible();
    const menu = list().element();
    const room = menu.scrollHeight - menu.clientHeight;
    expect(room).toBeGreaterThan(40);

    menu.scrollTop = room;
    /* Nothing pulls it back to the highlighted row afterwards. */
    await pause(300);
    expect(menu.scrollTop).toBeGreaterThan(20);
    await expect.element(list().getByRole("option", { name: /Link/ })).toBeInViewport();
  });
});
