import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, propertyBox, register, unique, choose } from "./helpers";

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

    /* Dates on, as a select dated before the switch went keeps them. Written
       once the page is up, so the boxes come by the stream and the page that
       draws them has hydrated: a box filled before that saves nothing. */
    const box = propertyBox(page, "Status");
    await expect(box).toBeVisible();
    const board = (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
      properties: { id: string; name: string }[];
    };
    const statusId = board.properties.find((p) => p.name === "Status")!.id;
    expect(
      (await page.request.patch(`/api/properties/${statusId}`, { data: { dated: true } })).ok(),
    ).toBe(true);
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

    /* The ticks of "Shown when" are the checkbox Settings draws. */
    const priority = propertyBox(page, "Priority");
    await priority.getByRole("button", { name: "Shown when…" }).click();
    await choose(priority.getByLabel("Shown when of Priority"), "Status");
    const tick = priority.getByLabel("Todo", { exact: true });
    const geometry = await checkboxGeometry(tick);
    expect(geometry).toMatchObject({
      appearance: "none",
      width: 14,
      height: 14,
      radius: "3px",
      background: await token(tick, "--bg-input"),
      border: await token(tick, "--line-dash"),
    });
    expect(geometry.labelHeight).toBeGreaterThanOrEqual(24);

    /* The words are part of the control. */
    await priority.getByText("Todo", { exact: true }).click();
    await expect(tick).toBeChecked();
    await expect(tick).toHaveCSS("background-color", await token(tick, "--accent"));

    /* The keyboard reaches it, and it says so. */
    await tick.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(tick).toBeFocused();
    await expect(tick).toHaveCSS("outline-color", await token(tick, "--focus-ring"));
    await expect(tick).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Space");
    await expect(tick).not.toBeChecked();

    /* The switches of Settings → Project are the same control. */
    await gotoSettings(page, projectId, "project");
    const releases = page.getByRole("switch", { name: "Use releases" });
    expect(await checkboxGeometry(releases)).toEqual(geometry);
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

/** How a quiet text button reads, at rest. */
async function textLook(button: Locator) {
  await expect(button).toBeVisible();
  return button.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      height: el.getBoundingClientRect().height,
      border: style.borderTopWidth,
      transform: style.textTransform,
      mono: style.fontFamily.includes("Mono"),
    };
  });
}

/** A text button is quiet until the pointer is on it, and says when it has focus. */
async function expectTextButton(page: import("@playwright/test").Page, button: Locator) {
  expect(await textLook(button)).toEqual({
    height: 28,
    border: "0px",
    transform: "none",
    mono: false,
  });
  await page.mouse.move(0, 0);
  await expect(button).toHaveCSS("color", await token(button, "--muted"));
  await button.hover();
  await expect(button).toHaveCSS("color", await token(button, "--text-2"));
  await page.mouse.move(0, 0);
  await button.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS("outline-style", "solid");
  await expect(button).toHaveCSS("outline-color", await token(button, "--focus-ring"));
}

test.describe("A button in Views and Types looks like a button", () => {
  test("Make main and Card view are text buttons; Shows as stays a label", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Text buttons"));
    await gotoSettings(page, projectId, "views");

    await expectTextButton(page, page.getByRole("button", { name: "Make Phases the main view" }));
    await expectTextButton(page, page.getByRole("link", { name: "Card view of Board" }));

    const label = page.getByText("Shows as", { exact: true }).first();
    expect(await textLook(label)).toMatchObject({ transform: "uppercase", mono: true });
    await expect(label).toHaveCSS("color", await token(label, "--faint"));
  });

  test("the actions of a type are text buttons, and its groups read as headings", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Type buttons"));
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Type", type: "select", options: ["Bug", "Story"] },
    });
    expect(made.ok()).toBeTruthy();
    await gotoSettings(page, projectId, "types");
    await choose(page.getByLabel("Types come from"), "Type");

    const sheet = page.getByTestId("type-sheet");
    await expectTextButton(page, sheet.getByRole("button", { name: "Only on Bug" }).first());

    /* A group heading reads as the head of the card view's table does. */
    for (const name of ["Every type", "This type"]) {
      const heading = sheet.getByRole("heading", { name });
      expect(await textLook(heading)).toMatchObject({ transform: "uppercase", mono: true });
      await expect(heading).toHaveCSS("font-size", "9.5px");
      await expect(heading).toHaveCSS("color", await token(heading, "--faint"));
    }
  });

  test("the ghost border and the danger words are tokens", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Button tokens"));
    await gotoSettings(page, projectId, "import");
    const file = page.getByLabel("The Trello export to bring in");
    await expect(file).toBeEnabled();
    const border = await file.evaluate(
      (input) => getComputedStyle(input, "::file-selector-button").borderTopColor,
    );
    expect(border).toBe(await token(file, "--line-ghost"));

    await gotoSettings(page, projectId, "project");
    const danger = page.getByRole("button", { name: "Delete project" });
    await expect(danger).toHaveCSS("color", await token(danger, "--danger-ink"));
  });
});
