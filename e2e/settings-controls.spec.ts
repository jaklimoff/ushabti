import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, propertyBox, register, unique } from "./helpers";

type Locator = import("@playwright/test").Locator;

/*
 * The page is dark, so the browser has to be told: without color-scheme it
 * draws its own controls light, a white box on a black page.
 */

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

/** The visible box of a checkbox and the label round it. */
async function checkboxGeometry(box: Locator) {
  /* Settings is drawn hidden under the loading page first. */
  await expect(box).toBeVisible();
  return box.evaluate((input) => {
    const style = getComputedStyle(input);
    const label = input.closest("label")!.getBoundingClientRect();
    return {
      appearance: style.appearance,
      width: input.getBoundingClientRect().width,
      height: input.getBoundingClientRect().height,
      radius: style.borderTopLeftRadius,
      background: style.backgroundColor,
      border: style.borderTopColor,
      labelHeight: label.height,
    };
  });
}

test.describe("Settings draws its controls dark", () => {
  test("the page says it is dark, and an empty date reads muted", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Dark controls"));
    await gotoSettings(page, projectId);

    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      "dark",
    );

    const box = propertyBox(page, "Status");
    await box.getByLabel("Options carry dates").check();
    const start = box.getByLabel("Start of Todo");
    await expect(start).toHaveValue("");
    const muted = await token(start, "--muted");
    await expect(start).toHaveCSS("color", muted);
    /* Focus does not make the placeholder read as a date. */
    await start.focus();
    await expect(start).toHaveCSS("color", muted);

    /* A date in it reads as text, not as a placeholder. */
    await start.fill("2026-10-01");
    await start.blur();
    await expect(start).toHaveCSS("color", await token(start, "--text-3"));
  });

  test("one checkbox: a 14 px box with a ring, a label to press and a 24 px row", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("One checkbox"));
    await gotoSettings(page, projectId);

    const status = propertyBox(page, "Status");
    const dated = status.getByLabel("Options carry dates");
    const geometry = await checkboxGeometry(dated);
    expect(geometry).toMatchObject({
      appearance: "none",
      width: 14,
      height: 14,
      radius: "3px",
      background: await token(dated, "--bg-input"),
      border: await token(dated, "--line-dash"),
    });
    expect(geometry.labelHeight).toBeGreaterThanOrEqual(24);

    /* The words are part of the control. */
    await status.getByText("Options carry dates", { exact: true }).click();
    await expect(dated).toBeChecked();
    await expect(dated).toHaveCSS("background-color", await token(dated, "--accent"));

    /* The keyboard reaches it, and it says so. */
    await dated.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(dated).toBeFocused();
    await expect(dated).toHaveCSS("outline-color", await token(dated, "--focus-ring"));
    await expect(dated).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Space");
    await expect(dated).not.toBeChecked();

    /* The ticks of "Shown when" are the same control. */
    const priority = propertyBox(page, "Priority");
    await priority.getByRole("button", { name: "Shown when…" }).click();
    await priority.getByLabel("Shown when of Priority").selectOption({ label: "Status" });
    const tick = priority.getByLabel("Todo", { exact: true });
    expect(await checkboxGeometry(tick)).toEqual(geometry);
  });

  test("the file button of Import looks like a ghost button", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("File button"));
    await gotoSettings(page, projectId, "import");
    const file = page.getByLabel("The Trello export to bring in");
    await expect(file).toBeEnabled();

    const button = await file.evaluate((input) => {
      const style = getComputedStyle(input, "::file-selector-button");
      return {
        background: style.backgroundColor,
        color: style.color,
        border: style.borderTopColor,
      };
    });
    expect(button).toEqual({
      background: "rgba(0, 0, 0, 0)",
      color: await token(file, "--muted"),
      border: "rgb(31, 34, 41)",
    });
  });
});
