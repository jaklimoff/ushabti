import { afterEach, describe, expect, test } from "vitest";
import { page, type Locator } from "vitest/browser";
import type { BoardData, PropertyDTO } from "@/lib/types";
import { newProject, propertyOf, renderWithBoard, withTask, type Answer } from "@/test/board";
import { ProjectPanel } from "./ProjectPanel";
import { PropertiesPanel } from "./PropertiesPanel";

/*
 * Sprints in Settings: the two switches of Settings -> Project, the cadence
 * box and the shipped fold of the Properties page. Each test was a test of
 * the end to end spec its block names, and carries its name or says which
 * half it is. What the routes make and keep is `sprint-route.test.ts`.
 */

const byTestId = (id: string) => page.getByTestId(id);
const gone = (locator: ReturnType<typeof page.getByText>) =>
  expect.element(locator).not.toBeInTheDocument();

afterEach(() => page.viewport(1440, 900));

const choose = async (select: Locator, label: string) => {
  const list = select.element().getAttribute("aria-controls");
  await select.click();
  await page
    .elementLocator(document.getElementById(list!)!)
    .getByRole("option", { name: label, exact: true })
    .click();
};

/** An option as the server sends it. */
function option(
  name: string,
  position: string,
  more: Partial<PropertyDTO["options"][number]> = {},
) {
  return {
    id: crypto.randomUUID(),
    name,
    color: "#6d5bd0",
    position,
    startAt: null,
    targetAt: null,
    shippedAt: null,
    note: null,
    ...more,
  };
}

/** Sprints as Use sprints makes them from 2036-10-05, with a length of 14. */
function withSprints(data: BoardData, options = ["Sprint 1", "Sprint 2"]): PropertyDTO {
  const sprint: PropertyDTO = {
    id: crypto.randomUUID(),
    name: "Sprint",
    type: "iteration",
    position: "z",
    config: { cadence: { length: 14 } },
    options: options.map((name, i) =>
      option(name, `a${i}`, {
        startAt: `2036-10-${String(5 + 14 * i).padStart(2, "0")}`,
        targetAt: `2036-10-${String(18 + 14 * i).padStart(2, "0")}`,
      }),
    ),
  };
  data.properties.push(sprint);
  return sprint;
}

/* ---- e2e/cadence.spec.ts and e2e/sprints.spec.ts: the switches ----------- */

describe("Use sprints and Use releases", () => {
  /* The server makes the property; the next read of the board finds it. */
  function turning(data: BoardData): Answer {
    return ({ method, path }) => {
      if (method === "POST" && path.endsWith("/sprints")) {
        data.project.sprintBy = withSprints(data).id;
        return { status: 201, body: {} };
      }
      if (method === "POST" && path.endsWith("/releases")) {
        const release: PropertyDTO = {
          id: crypto.randomUUID(),
          name: "Release",
          type: "select",
          position: "y",
          config: { dated: true },
          options: [],
        };
        data.properties.push(release);
        data.project.releaseBy = release.id;
        return { status: 201, body: {} };
      }
      if (method === "DELETE" && path.endsWith("/sprints")) data.project.sprintBy = null;
      if (method === "DELETE" && path.endsWith("/releases")) data.project.releaseBy = null;
    };
  }

  /* The screen half of e2e/cadence.spec.ts "Use sprints asks for the length
     and the first day, and makes two sprints". */
  test("Use sprints asks for the length and the first day, and makes two sprints", async () => {
    const data = newProject();
    const { sent } = await renderWithBoard(<ProjectPanel files={false} />, data, turning(data));

    const length = page.getByLabelText("Sprint length in days");
    await expect.element(length).toHaveValue("14");
    await length.fill("7");
    await page.getByLabelText("First day of the first sprint").fill("2036-11-02");
    const toggle = page.getByRole("switch", { name: "Use sprints" });
    await toggle.click();
    await expect.element(toggle).toBeChecked();
    /* On, the questions are answered and go. */
    await gone(page.getByLabelText("Sprint length in days"));
    const made = sent("POST", /\/sprints$/);
    expect(made).toHaveLength(1);
    expect(made[0].body).toEqual({ length: 7, startAt: "2036-11-02" });
  });

  /* The screen half of e2e/sprints.spec.ts "an admin turns sprints on in one
     press; a member and an agent are refused". */
  test("an admin turns sprints on in one press; a member is not offered the switch", async () => {
    const member = newProject();
    member.project.role = "member";
    const first = await renderWithBoard(<ProjectPanel files={false} />, member);
    await expect.element(page.getByLabelText("Project name")).toBeVisible();
    await gone(page.getByRole("switch", { name: "Use sprints" }));
    await gone(page.getByRole("switch", { name: "Use releases" }));
    await first.screen.unmount();

    const data = newProject();
    const on = await renderWithBoard(<ProjectPanel files={false} />, data, turning(data));
    const toggle = page.getByRole("switch", { name: "Use sprints" });
    await expect.element(toggle).not.toBeChecked();
    await expect.element(page.getByText(/a sprint property Sprint with Sprint 1/)).toBeVisible();
    await expect.element(page.getByText(/a list Backlog of the tasks in no sprint/)).toBeVisible();

    await toggle.click();
    await expect.element(toggle).toBeChecked();
    await expect.element(page.getByText(/Sprints are the options of Sprint/)).toBeVisible();
    expect(on.sent("POST", /\/sprints$/)).toHaveLength(1);

    /* Off asks in place, in real numbers. Cancel leaves it on. */
    const sprint = propertyOf(data, "Sprint");
    withTask(data, "Alpha", { Sprint: "Sprint 1" });
    data.views.push(
      {
        ...data.views[0],
        id: crypto.randomUUID(),
        name: "Sprint",
        isDefault: false,
        filters: { rules: [{ propertyId: sprint.id, op: "is", values: ["__current__"] }] },
      },
      {
        ...data.views[0],
        id: crypto.randomUUID(),
        name: "Backlog",
        kind: "list",
        isDefault: false,
        filters: { rules: [{ propertyId: sprint.id, op: "is", values: ["__none__"] }] },
      },
    );
    await on.screen.unmount();
    const again = await renderWithBoard(<ProjectPanel files={false} />, data, turning(data));
    await toggle.click();
    const question = page.getByRole("alertdialog");
    await expect
      .element(question)
      .toHaveAttribute(
        "aria-label",
        "Turn sprints off? Nothing is deleted: Sprint keeps its 2 sprints, 1 task keeps its sprint, and 2 views stay.",
      );
    await question.getByRole("button", { name: "Cancel" }).click();
    await expect.element(toggle).toBeChecked();
    expect(again.sent("DELETE")).toHaveLength(0);

    await toggle.click();
    await page.getByRole("button", { name: "Yes, turn off" }).click();
    await expect.element(toggle).not.toBeChecked();
    expect(again.sent("DELETE", /\/sprints$/)).toHaveLength(1);
    await expect.element(page.getByLabelText("Sprint length in days")).toBeVisible();
  });

  /* The screen half of e2e/sprints.spec.ts "an admin turns releases on: a
     dated Release with no options and a Roadmap on it". */
  test("an admin turns releases on, and off asks what stays", async () => {
    const data = newProject();
    const { sent } = await renderWithBoard(<ProjectPanel files={false} />, data, turning(data));
    const toggle = page.getByRole("switch", { name: "Use releases" });
    await expect.element(toggle).not.toBeChecked();
    await expect
      .element(page.getByText(/Adds a property Release with no releases yet/))
      .toBeVisible();

    await toggle.click();
    await expect.element(toggle).toBeChecked();
    expect(sent("POST", /\/releases$/)).toHaveLength(1);

    await toggle.click();
    await expect
      .element(page.getByRole("alertdialog"))
      .toHaveAttribute(
        "aria-label",
        "Turn releases off? Nothing is deleted: Release keeps its 0 releases, no task holds a release, and 0 views stay.",
      );
    await page.getByRole("button", { name: "Yes, turn off" }).click();
    await expect.element(toggle).not.toBeChecked();
    expect(sent("DELETE", /\/releases$/)).toHaveLength(1);

    /* The property page draws the dates, with no switch to learn. */
    const drawn = await renderWithBoard(<PropertiesPanel />, data);
    await expect.element(page.getByLabelText("Name of the Release property")).toBeInTheDocument();
    await gone(page.getByLabelText("Options carry dates"));
    await drawn.screen.unmount();
  });
});

/* ---- e2e/cadence.spec.ts: the cadence box -------------------------------- */

describe("The cadence in Settings", () => {
  const sprintBox = () =>
    byTestId("property-box").filter({
      has: page.getByLabelText("Name of the Sprint property"),
    });
  const lengthBox = () => sprintBox().getByLabelText("Sprint length in days of Sprint");

  /* The screen half of "Settings shows the cadence, saved on blur and on
     leave". The member refused is the route test. */
  test("Settings shows the cadence, saved on blur and on leave", async () => {
    const data = newProject();
    withSprints(data);
    const { sent } = await renderWithBoard(<PropertiesPanel />, data);
    const patches = () => sent("PATCH", /^\/api\/properties\/[0-9a-f-]+$/);

    const length = lengthBox();
    await expect.element(length).toHaveValue("14");
    await gone(sprintBox().getByLabelText("Sprints kept ahead of Sprint"));

    await length.fill("7");
    (length.element() as HTMLElement).blur();
    await expect.poll(() => patches().length).toBe(1);
    expect(patches()[0].body).toEqual({ cadence: { length: 7 } });

    await length.fill("10");
    await expect.element(length).toHaveFocus();
    // A closed tab raises pagehide and no blur.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await expect.poll(() => patches().length).toBe(2);
    expect(patches()[1].body).toEqual({ cadence: { length: 10 } });
  });

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`the cadence keeps off the card edge at ${width} px`, async () => {
      await page.viewport(width, height);
      const data = newProject();
      withSprints(data);
      await renderWithBoard(<PropertiesPanel />, data);
      await expect.element(lengthBox()).toHaveValue("14");
      await expect.element(lengthBox()).toBeVisible();
      await expect.poll(() => edgeRoom(sprintBox().element())).toBeGreaterThanOrEqual(12);
    });
  }

  test("the cadence starts where the property's name does", async () => {
    const data = newProject();
    withSprints(data);
    await renderWithBoard(<PropertiesPanel />, data);
    await expect.element(lengthBox()).toBeVisible();
    await expect
      .poll(() => fromName(sprintBox().element(), lengthBox().element()))
      .toBeLessThanOrEqual(3);
  });
});

/** How far the nearest words or control sit from the box's own edges. */
function edgeRoom(root: Element): number {
  const edge = root.getBoundingClientRect();
  let left = Infinity;
  let right = Infinity;
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    const words = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "",
    );
    if (el.children.length > 0 && !words) continue;
    left = Math.min(left, r.left - edge.left);
    right = Math.min(right, edge.right - r.right);
  }
  if (left === Infinity) throw new Error("The box draws nothing");
  return Math.min(left, right);
}

/** How far `line` starts from the words of the property's name in `box`. */
function fromName(box: Element, line: Element): number {
  const name = box.querySelector('input[aria-label^="Name of the "][aria-label$=" property"]')!;
  const style = getComputedStyle(name);
  const at =
    name.getBoundingClientRect().left +
    parseFloat(style.paddingLeft) +
    parseFloat(style.borderLeftWidth);
  return Math.abs(line.getBoundingClientRect().left - at);
}

/* ---- e2e/iteration.spec.ts ----------------------------------------------- */

describe("An iteration in Settings", () => {
  test("Settings offers Sprint, and its options always show the date boxes", async () => {
    const data = newProject();
    const { sent } = await renderWithBoard(<PropertiesPanel />, data, ({ method, path, body }) => {
      if (method !== "POST" || !path.endsWith("/properties")) return;
      const asked = body as { name: string; type: PropertyDTO["type"]; options: string[] };
      data.properties.push({
        id: crypto.randomUUID(),
        name: asked.name,
        type: asked.type,
        position: "z",
        config: {},
        options: asked.options.map((name, i) => option(name, `a${i}`)),
      });
      return { status: 201, body: {} };
    });

    await page.getByLabelText("New property name").fill("Cycle");
    await choose(page.getByLabelText("Type of the new property"), "Sprint");
    await page.getByLabelText("Options of the new property").fill("Sprint 1");
    await page.getByRole("button", { name: "Add property" }).click();
    await expect.poll(() => sent("POST", /\/properties$/).length).toBe(1);
    expect(sent("POST", /\/properties$/)[0].body).toMatchObject({
      name: "Cycle",
      type: "iteration",
    });

    const box = byTestId("property-box").filter({
      has: page.getByLabelText("Name of the Cycle property"),
    });
    await expect.element(box.getByText("Sprint", { exact: true })).toBeVisible();
    await gone(box.getByLabelText("Options carry dates"));
    await expect.element(box.getByLabelText("Start of Sprint 1")).toBeVisible();
    await expect.element(box.getByLabelText("Target of Sprint 1")).toBeVisible();
    await expect.element(box.getByLabelText("Note of Sprint 1")).toBeVisible();
  });
});

/* ---- e2e/shipped-iteration.spec.ts --------------------------------------- */

describe("A shipped option in Settings", () => {
  const boxOf = (name: string) =>
    byTestId("property-box").filter({
      has: page.getByLabelText(`Name of the ${name} property`),
    });

  test("Settings folds the shipped sprints behind one row, and unship works inside it", async () => {
    const data = newProject();
    const sprint = withSprints(data, ["S1", "S2", "S3"]);
    sprint.options[0].shippedAt = "2036-10-18";
    const { sent } = await renderWithBoard(<PropertiesPanel />, data, ({ method, path }) => {
      if (method === "PATCH" && path.endsWith(sprint.options[0].id)) {
        sprint.options[0].shippedAt = null;
      }
    });

    const box = boxOf("Sprint");
    await expect.element(box.getByLabelText("Start of S2")).toBeVisible();
    await gone(box.getByLabelText("Start of S1"));
    const fold = box.getByRole("button", { name: "1 shipped" });
    await expect.element(fold).toHaveAttribute("aria-expanded", "false");

    await fold.click();
    await expect.element(box.getByLabelText("Start of S1")).toBeVisible();
    await expect.element(box.getByText(/^Shipped \d{4}-\d{2}-\d{2}/)).toBeVisible();
    await box.getByRole("button", { name: "Unship S1" }).click();
    await box.getByRole("button", { name: "Yes, unship" }).click();
    await expect.poll(() => sent("PATCH", /^\/api\/options\//).length).toBe(1);
    expect(sent("PATCH", /^\/api\/options\//)[0].body).toEqual({ shippedAt: null });

    await gone(box.getByRole("button", { name: /shipped$/ }));
    await expect.element(box.getByLabelText("Start of S1")).toBeVisible();
  });

  /* The Settings half of "a shipped version of a dated select is drawn
     exactly as before". The board and the panel are `Sprints.test.tsx` of
     the board. */
  test("a shipped version of a dated select keeps its boxes and no fold", async () => {
    const data = newProject();
    data.properties.push({
      id: crypto.randomUUID(),
      name: "Version",
      type: "select",
      position: "z",
      config: { dated: true },
      options: [
        option("V1", "a", { targetAt: "2036-10-05", shippedAt: "2036-10-05" }),
        option("V2", "b"),
        option("V3", "c"),
      ],
    });
    await renderWithBoard(<PropertiesPanel />, data);
    const box = boxOf("Version");
    await expect.element(box.getByLabelText("Start of V1")).toBeVisible();
    await gone(box.getByRole("button", { name: /shipped$/ }));
  });
});
