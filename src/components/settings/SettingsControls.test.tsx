import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { withWhen } from "@/lib/when";
import type { BoardData, PropertyDTO, When } from "@/lib/types";
import { ME, newProject, propertyOf, renderWithBoard, type Answer } from "@/test/board";
import { at } from "@/test/next-navigation";
import { ImportPanel } from "./ImportPanel";
import { ProjectPanel } from "./ProjectPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { SettingsShell } from "./SettingsShell";
import { TypesPanel } from "./TypesPanel";
import { ViewsPanel } from "./ViewsPanel";

/*
 * How the controls of Settings look: sizes and colours, measured in a real
 * browser with the app's own stylesheet. Each test here was a test of
 * `e2e/settings-controls.spec.ts`, and its name is the name it had there.
 *
 * The page is dark, so the browser has to be told: without color-scheme it
 * draws its own controls light, a white box on a black page.
 */

const PROPERTY = /^\/api\/properties\/[0-9a-f-]+$/;

/** What a token on :root holds, as the page computes it. */
function token(name: string) {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const said = getComputedStyle(probe).color;
  probe.remove();
  return said;
}

const css = (locator: Locator, property: string, pseudo?: string) =>
  getComputedStyle(locator.element(), pseudo).getPropertyValue(property);

async function looks(locator: Locator, property: string, value: string) {
  await expect.poll(() => css(locator, property)).toBe(value);
}

/* The server keeps a rule it is sent and hides nothing with it, so the read
   that follows a write still has it. */
function serving(data: BoardData): Answer {
  const server = structuredClone(data);
  return ({ method, path, body }) => {
    if (method === "GET" && (path.endsWith("/board") || path.endsWith("/settings")))
      return { body: server };
    if (method === "PATCH" && PROPERTY.test(path)) {
      const property = server.properties.find((p) => path.endsWith(p.id))!;
      const sent = body as { when?: When | null };
      if ("when" in sent) property.config = withWhen(property, sent.when ?? null);
      return { body: { property } };
    }
    if (method === "GET" && /\/count$/.test(path)) return { body: { tasks: 0, names: [] } };
  };
}

/** Draws one settings page as the layout does. */
async function draw(slug: string, panel: React.ReactNode, data: BoardData = newProject()) {
  at.pathname = `/p/${data.project.id}/settings/${slug}`;
  return renderWithBoard(
    <SettingsShell initial={data} user={ME} version="0.0.0">
      {panel}
    </SettingsShell>,
    data,
    serving(data),
  );
}

const propertyBox = (name: string) =>
  page
    .getByTestId("property-box")
    .filter({ has: page.getByLabelText(`Name of the ${name} property`) });

async function choose(select: Locator, label: string) {
  await select.click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

/** Puts the keyboard on `target` the way a person does, so it shows a ring. */
async function tabTo(target: Locator) {
  (target.element() as HTMLElement).focus();
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}{Tab}");
  await expect.element(target).toHaveFocus();
}

/** The visible box of a checkbox and the label round it. */
async function checkboxGeometry(box: Locator) {
  await expect.element(box).toBeVisible();
  const input = box.element() as HTMLInputElement;
  const style = getComputedStyle(input);
  return {
    appearance: style.appearance,
    width: input.getBoundingClientRect().width,
    height: input.getBoundingClientRect().height,
    radius: style.borderTopLeftRadius,
    background: style.backgroundColor,
    border: style.borderTopColor,
    labelHeight: input.closest("label")!.getBoundingClientRect().height,
  };
}

const fileBox = () => page.getByLabelText("The Trello export to bring in");

afterEach(() => {
  at.pathname = null;
});

describe("Settings draws its controls dark", () => {
  test("the page says it is dark, and an empty date reads muted", async () => {
    const data = newProject();
    // Dates on, as a select dated before the switch went keeps them.
    const status: PropertyDTO = propertyOf(data, "Status");
    status.config = { dated: true };
    await draw("properties", <PropertiesPanel />, data);

    expect(getComputedStyle(document.documentElement).colorScheme).toBe("dark");

    const start = propertyBox("Status").getByLabelText("Start of Todo");
    await expect.element(start).toHaveValue("");
    await looks(start, "color", token("--muted"));
    /* Focus does not make the placeholder read as a date. */
    (start.element() as HTMLElement).focus();
    await looks(start, "color", token("--muted"));

    /* A date in it reads as text, not as a placeholder. */
    await start.fill("2026-10-01");
    await looks(start, "color", token("--text-3"));
  });

  test("one checkbox: a 14 px box with a ring, a label to press and a 24 px row", async () => {
    const data = newProject();
    const drawn = await draw("properties", <PropertiesPanel />, data);

    /* The ticks of "Shown when" are the checkbox Settings draws. */
    const priority = propertyBox("Priority");
    await priority.getByRole("button", { name: "Shown when…" }).click();
    await choose(priority.getByLabelText("Shown when of Priority"), "Status");
    const tick = priority.getByLabelText("Todo", { exact: true });
    const geometry = await checkboxGeometry(tick);
    expect(geometry).toMatchObject({
      appearance: "none",
      width: 14,
      height: 14,
      radius: "3px",
      background: token("--bg-input"),
      border: token("--line-dash"),
    });
    expect(geometry.labelHeight).toBeGreaterThanOrEqual(24);

    /* The words are part of the control. */
    await priority.getByText("Todo", { exact: true }).click();
    await expect.element(tick).toBeChecked();
    await looks(tick, "background-color", token("--accent"));

    /* The keyboard reaches it, and it says so. */
    await tabTo(tick);
    await looks(tick, "outline-color", token("--focus-ring"));
    await looks(tick, "outline-style", "solid");
    await userEvent.keyboard(" ");
    await expect.element(tick).not.toBeChecked();

    /* The switches of Settings → Project are the same control. */
    await drawn.screen.unmount();
    await draw("project", <ProjectPanel files={false} />, data);
    const releases = page.getByRole("switch", { name: "Use releases" });
    expect(await checkboxGeometry(releases)).toEqual(geometry);
  });

  test("the file button of Import looks like a ghost button", async () => {
    await draw("import", <ImportPanel />);
    await expect.element(fileBox()).toBeEnabled();
    const button = "::file-selector-button";
    expect({
      background: css(fileBox(), "background-color", button),
      color: css(fileBox(), "color", button),
      border: css(fileBox(), "border-top-color", button),
    }).toEqual({
      background: "rgba(0, 0, 0, 0)",
      color: token("--muted"),
      border: "rgb(31, 34, 41)",
    });
  });
});

/** How a quiet text button reads, at rest. */
async function textLook(button: Locator) {
  await expect.element(button).toBeVisible();
  const el = button.element();
  const style = getComputedStyle(el);
  return {
    height: el.getBoundingClientRect().height,
    border: style.borderTopWidth,
    transform: style.textTransform,
    mono: style.fontFamily.includes("Mono"),
  };
}

/** A text button is quiet until the pointer is on it, and says when it has focus. */
async function expectTextButton(button: Locator) {
  expect(await textLook(button)).toEqual({
    height: 28,
    border: "0px",
    transform: "none",
    mono: false,
  });
  await looks(button, "color", token("--muted"));
  await userEvent.hover(button);
  await looks(button, "color", token("--text-2"));
  await userEvent.unhover(button);
  await tabTo(button);
  await looks(button, "outline-style", "solid");
  await looks(button, "outline-color", token("--focus-ring"));
}

describe("A button in Views and Types looks like a button", () => {
  test("Make main and Card view are text buttons; Shows as stays a label", async () => {
    await draw("views", <ViewsPanel />);

    await expectTextButton(page.getByRole("button", { name: "Make Phases the main view" }));
    await expectTextButton(page.getByRole("link", { name: "Card view of Board" }));

    const label = page.getByText("Shows as", { exact: true }).first();
    expect(await textLook(label)).toMatchObject({ transform: "uppercase", mono: true });
    await looks(label, "color", token("--faint"));
  });

  test("the actions of a type are text buttons, and its groups read as headings", async () => {
    const data = newProject();
    const priority = propertyOf(data, "Priority");
    const type: PropertyDTO = {
      ...priority,
      id: "00000000-0000-4000-8000-00000000d001",
      name: "Type",
      position: "b0000000",
      options: ["Bug", "Story"].map((name, i) => ({
        ...priority.options[0],
        id: `00000000-0000-4000-8000-00000000d10${i}`,
        name,
        position: `a000000${i}`,
      })),
    };
    data.properties.push(type);
    data.project.typeBy = type.id;
    await draw("types", <TypesPanel />, data);

    const sheet = page.getByTestId("type-sheet");
    await expectTextButton(sheet.getByRole("button", { name: "Only on Bug" }).first());

    /* A group heading reads as the head of the card view's table does. */
    for (const name of ["Every type", "This type"]) {
      const heading = sheet.getByRole("heading", { name });
      expect(await textLook(heading)).toMatchObject({ transform: "uppercase", mono: true });
      await looks(heading, "font-size", "9.5px");
      await looks(heading, "color", token("--faint"));
    }
  });

  test("the ghost border and the danger words are tokens", async () => {
    const drawn = await draw("import", <ImportPanel />);
    await expect.element(fileBox()).toBeEnabled();
    expect(css(fileBox(), "border-top-color", "::file-selector-button")).toBe(
      token("--line-ghost"),
    );
    await drawn.screen.unmount();

    await draw("project", <ProjectPanel files={false} />);
    const danger = page.getByRole("button", { name: "Delete project" });
    await looks(danger, "color", token("--danger-ink"));
  });
});
