import { expect, test } from "@playwright/test";
import { choose, createProject, gotoSettings, register, unique } from "./helpers";

type Locator = import("@playwright/test").Locator;

/** What a token on :root holds, as the page computes it. */
async function token(locator: Locator, name: string) {
  return locator.evaluate((_, n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const said = getComputedStyle(probe).color;
    probe.remove();
    return said;
  }, name);
}

/** Whether every option is drawn where a click would land on it. */
async function nothingCut(list: Locator) {
  return list.evaluate((menu) => {
    const rows = [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
    menu.scrollTop = 0;
    const box = menu.getBoundingClientRect();
    const inWindow =
      box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth;
    const first = rows[0].getBoundingClientRect();
    const hit = document.elementFromPoint(first.left + 4, first.top + first.height / 2);
    return inWindow && !!hit && rows[0].contains(hit);
  });
}

test.describe("A settings select is the app's own menu", () => {
  test("a 28 px button with the value and a chevron, opening the board's menu", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Select look"));
    await gotoSettings(page, projectId, "project");

    const done = page.getByLabel("The property that says a task is done");
    const progress = page.getByLabel("Count progress by");
    await expect(done).toBeVisible();
    expect(await done.evaluate((el) => el.tagName)).toBe("BUTTON");
    await expect(page.locator("select")).toHaveCount(0);
    await expect(done).toHaveAttribute("role", "combobox");
    await expect(done).toHaveText(/Archived only/);
    await expect(done).toHaveCSS("height", "28px");

    /* Two selects in one card line up, however short their words. */
    const wide = async (l: Locator) => (await l.boundingBox())!.width;
    expect(await wide(progress)).toBeGreaterThanOrEqual(120);
    expect(await wide(done)).toBeGreaterThanOrEqual(120);

    await done.click();
    await expect(done).toHaveAttribute("aria-expanded", "true");
    const list = page.getByRole("listbox");
    await expect(list).toHaveCSS("background-color", await token(list, "--bg-menu"));
    await expect(list.getByRole("option", { name: /Archived only/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    /* A click outside closes it. */
    await page.mouse.click(5, 5);
    await expect(list).toHaveCount(0);
    await expect(done).toHaveAttribute("aria-expanded", "false");
  });

  test("the keys open it, walk it, pick, close it and jump by letter", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Select keys"));
    await gotoSettings(page, projectId);

    const type = page.getByLabel("Type of the new property");
    /* Settings is drawn hidden under the loading page first. */
    await expect(type).toBeVisible();
    await expect(type).toHaveAttribute("data-value", "select");
    await type.focus();

    /* Enter opens on the current value. */
    await page.keyboard.press("Enter");
    await expect(type).toHaveAttribute("aria-expanded", "true");
    const list = page.getByRole("listbox");
    const at = async () => {
      const id = await type.getAttribute("aria-activedescendant");
      return list.locator(`[id="${id}"]`).innerText();
    };
    expect(await at()).toMatch(/^Select/);

    /* Down and Up move the highlight; Enter picks it. */
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await at()).toMatch(/^Iteration/);
    await page.keyboard.press("ArrowUp");
    expect(await at()).toMatch(/^Multi-select/);
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(type).toHaveAttribute("data-value", "multi_select");
    await expect(type).toBeFocused();

    /* Esc closes without picking and leaves the keys on the button. */
    await page.keyboard.press("ArrowDown");
    await expect(list).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(type).toBeFocused();
    await expect(type).toHaveAttribute("data-value", "multi_select");

    /* A letter jumps to the first option it starts. */
    await page.keyboard.press(" ");
    await expect(list).toBeVisible();
    await page.keyboard.press("n");
    expect(await at()).toMatch(/^Number/);
    await page.keyboard.press("Enter");
    await expect(type).toHaveAttribute("data-value", "number");

    /* A click picks as well. */
    await choose(type, "Link");
    await expect(type).toHaveAttribute("data-value", "link");
    await expect(type).toHaveText(/Link/);
  });

  test("the menu is not cut by the card or the bottom of the window", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 420 });
    await register(page);
    const projectId = await createProject(page, unique("Select place"));
    await gotoSettings(page, projectId);

    const type = page.getByLabel("Type of the new property");
    await type.scrollIntoViewIfNeeded();
    /* Put the button near the bottom of the window. */
    await type.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const scroller = document.scrollingElement!;
      scroller.scrollTop += box.bottom - innerHeight + 40;
    });
    await type.click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    expect(await nothingCut(list)).toBe(true);
    const menu = (await list.boundingBox())!;
    const button = (await type.boundingBox())!;
    expect(menu.y + menu.height).toBeLessThanOrEqual(button.y);
  });

  test("a menu taller than its room scrolls, and stays where it is scrolled", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 260 });
    await register(page);
    const projectId = await createProject(page, unique("Select scroll"));
    await gotoSettings(page, projectId);

    const type = page.getByLabel("Type of the new property");
    await expect(type).toBeVisible();
    /* Put the button in the middle, so neither side holds the whole menu. */
    await type.evaluate((el) => {
      const box = el.getBoundingClientRect();
      document.scrollingElement!.scrollTop += box.top - innerHeight / 2;
    });
    /* Opened by key, so the highlight sits on the first row and no pointer
       moves it. */
    await type.focus();
    await page.keyboard.press("Enter");
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    const room = await list.evaluate((menu) => menu.scrollHeight - menu.clientHeight);
    expect(room).toBeGreaterThan(40);

    await list.evaluate((menu, by) => (menu.scrollTop = by), room);
    /* Nothing pulls it back to the highlighted row afterwards. */
    await page.waitForTimeout(300);
    expect(await list.evaluate((menu) => menu.scrollTop)).toBeGreaterThan(20);
    await expect(list.getByRole("option", { name: /Link/ })).toBeInViewport();
  });
});
