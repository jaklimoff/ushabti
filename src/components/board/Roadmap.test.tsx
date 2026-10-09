import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import type { BoardData, PropertyDTO } from "@/lib/types";
import { detailOf, newProject, propertyOf, renderWithBoard, withTask } from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * The roadmap canvas and a bar's panel. Each test here was a test of
 * `e2e/roadmap.spec.ts` and carries its name. Where a bar starts and ends is
 * `roadmap.test.ts`; the board answer's `archivedUnder` and the refused
 * roadmap on a person property are `release-route.test.ts`. The first walk,
 * which makes the view from the strip, stays end to end.
 */

const byTestId = (id: string) => page.getByTestId(id);
/** The element's words hold `text`. `toHaveTextContent` asks for all of them. */
async function says(locator: Locator, text: string) {
  await expect.poll(() => locator.element().textContent ?? "").toContain(text);
}
const gone = (id: ReturnType<typeof byTestId>) => expect.element(id).not.toBeInTheDocument();
const rows = () => byTestId("roadmap-row");
const bars = () => byTestId("roadmap-bar");
const panel = () => byTestId("roadmap-panel");

afterEach(async () => {
  await page.viewport(1440, 900);
});

/** A day so many days after another, as YYYY-MM-DD. */
function plus(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/*
 * The spec's Version select: Ghost has a target and nothing to start it by,
 * Beta is open around today, Alpha shipped, and Someday has no target. The
 * view open is a roadmap of it, called Plan.
 */
function versions(): BoardData {
  const data = newProject();
  const today = data.today;
  const option = (
    name: string,
    position: string,
    dates: Partial<PropertyDTO["options"][number]>,
  ) => ({
    id: crypto.randomUUID(),
    name,
    color: "#3fb0c8",
    position,
    startAt: null,
    targetAt: null,
    shippedAt: null,
    note: null,
    ...dates,
  });
  data.properties.push({
    id: crypto.randomUUID(),
    name: "Version",
    type: "select",
    position: "a",
    config: {},
    options: [
      option("Ghost", "a", { targetAt: plus(today, 30) }),
      option("Beta", "b", { startAt: plus(today, -10), targetAt: plus(today, 20) }),
      option("Alpha", "c", {
        startAt: plus(today, -40),
        targetAt: plus(today, -15),
        shippedAt: plus(today, -14),
      }),
      option("Someday", "d", { startAt: plus(today, -5) }),
    ],
  });
  for (const view of data.views) view.isDefault = false;
  data.views.push({
    ...data.views[0],
    id: crypto.randomUUID(),
    name: "Plan",
    kind: "roadmap",
    groupById: propertyOf(data, "Version").id,
    position: "a9",
    isDefault: true,
  });
  return data;
}

const versionOf = (data: BoardData, name: string) =>
  propertyOf(data, "Version").options.find((o) => o.name === name)!;

/** Puts an archived task under an option, as a ship leaves it. */
function archivedUnder(data: BoardData, option: string, title: string) {
  const id = crypto.randomUUID();
  const number = data.tasks.length + data.archived.length + 1;
  data.archived.push({
    id,
    number,
    key: `${data.project.key}-${number}`,
    title,
    description: "",
    position: "z",
    archivedAt: "2026-09-25T10:00:00.000Z",
  });
  data.archivedUnder[versionOf(data, option).id] = {
    firstAt: "2026-09-01T10:00:00.000Z",
    count: 1,
    taskIds: [id],
  };
}

const overflow = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

describe("A roadmap", () => {
  /* The screen half of "a shipped option keeps its start in its archived
     work, and a filter takes rows away". Where the start comes from is
     `roadmap.test.ts`, and what the board sends of it the route test. */
  test("a shipped option keeps its start in its archived work, and a filter takes rows away", async () => {
    const data = versions();
    versionOf(data, "Ghost").targetAt = null;
    versionOf(data, "Alpha").startAt = null;
    archivedUnder(data, "Alpha", "Done work");
    const { ring } = await renderWithBoard(<BoardShell initialTask={null} />, data);

    await expect.poll(() => rows().elements()).toHaveLength(2);
    await says(rows().filter({ hasText: "Alpha" }), "1 task archived");

    // A rule on the roadmap's own property leaves only the rows it names.
    const plan = data.views.find((v) => v.name === "Plan")!;
    plan.filters = {
      rules: [
        {
          propertyId: propertyOf(data, "Version").id,
          op: "is",
          values: [versionOf(data, "Beta").id],
        },
      ],
    };
    ring();
    await expect.poll(() => rows().elements()).toHaveLength(1);
    await says(rows().first(), "Beta");
  });

  test("reads at phone width: the axis scrolls and the page does not", async () => {
    await page.viewport(390, 800);
    await renderWithBoard(<BoardShell initialTask={null} />, versions());

    await expect.poll(() => rows().elements()).toHaveLength(2);
    await expect.element(byTestId("roadmap-today")).toBeInViewport();
    expect(overflow()).toBe(0);
    const name = rows().first().element().querySelector("div")!.getBoundingClientRect();
    expect(name.width).toBeLessThan(130);
  });

  test("a bar opens its tasks in the panel, through the view's filters", async () => {
    const data = versions();
    versionOf(data, "Beta").note = "Ship it **fast**";
    data.properties.push({
      id: crypto.randomUUID(),
      name: "Team",
      type: "select",
      position: "b",
      config: {},
      options: ["Red", "Blue"].map((name, i) => ({
        id: crypto.randomUUID(),
        name,
        color: "#c47a3a",
        position: String(i),
        startAt: null,
        targetAt: null,
        shippedAt: null,
        note: null,
      })),
    });
    withTask(data, "One", { Version: "Beta", Team: "Red" });
    withTask(data, "Two", { Version: "Beta", Team: "Blue" });
    withTask(data, "Three", { Version: "Beta", Team: "Red" });
    archivedUnder(data, "Alpha", "Old work");
    const team = propertyOf(data, "Team");
    const version = propertyOf(data, "Version");
    const plan = data.views.find((v) => v.name === "Plan")!;
    plan.filters = { rules: [{ propertyId: team.id, op: "is", values: [team.options[0].id] }] };

    const { ring } = await renderWithBoard(<BoardShell initialTask={null} />, data, (s) => {
      const asked = /^\/api\/tasks\/([0-9a-f-]+)$/.exec(s.path);
      if (s.method !== "GET" || !asked) return;
      const task = data.tasks.find((t) => t.id === asked[1]);
      if (task) return { body: { task: detailOf(task) } };
    });

    // A click opens the name, the dates, the note and the tasks the bar fills from.
    const beta = bars().first();
    await beta.click();
    await expect.element(panel().getByRole("heading", { name: "Beta" })).toBeVisible();
    await says(byTestId("roadmap-panel-dates"), "–");
    await expect
      .element(byTestId("roadmap-panel-note").getByText("fast", { exact: true }))
      .toBeVisible();
    expect(byTestId("roadmap-panel-note").element().querySelector("strong")?.textContent).toBe(
      "fast",
    );
    const listed = () =>
      byTestId("roadmap-panel-task")
        .elements()
        .map((e) => e.textContent);
    await expect
      .poll(listed)
      .toEqual([expect.stringMatching(/One/), expect.stringMatching(/Three/)]);

    // A row opens its task as the list does, and closing the task brings the list back.
    await byTestId("roadmap-panel-task").filter({ hasText: "Three" }).click();
    await expect.element(byTestId("task-panel")).toBeVisible();
    await gone(panel());
    await page.getByRole("button", { name: "Close task" }).click();
    await expect.element(panel()).toBeVisible();

    // Escape closes it, and the cursor is on the bar again.
    await userEvent.keyboard("{Escape}");
    await gone(panel());
    await expect.element(beta).toHaveFocus();

    // Enter opens it, and the ✕ closes it the same way.
    await userEvent.keyboard("{Enter}");
    await expect.element(panel()).toBeVisible();
    await panel().getByRole("button", { name: "Close Beta" }).click();
    await gone(panel());
    await expect.element(beta).toHaveFocus();

    // Space too. A shipped option lists its archived work, marked.
    await userEvent.keyboard(" ");
    await expect.element(panel()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await gone(panel());
    await bars().nth(1).click();
    await expect.element(panel().getByRole("heading", { name: "Alpha" })).toBeVisible();
    await says(byTestId("roadmap-panel-dates"), "Shipped");
    await expect.poll(() => byTestId("roadmap-panel-task").elements()).toHaveLength(1);
    await says(byTestId("roadmap-panel-task"), "Old work");
    await says(byTestId("roadmap-panel-task"), "Archived");

    /* A filter that takes the row away takes the panel for good: lifting the
       filter brings the row back, and not the panel. */
    const rule = (names: string[]) => {
      plan.filters = {
        rules: [
          { propertyId: version.id, op: "is", values: names.map((n) => versionOf(data, n).id) },
        ],
      };
      ring();
    };
    rule(["Beta"]);
    await expect.poll(() => bars().elements()).toHaveLength(1);
    await gone(panel());
    rule(["Beta", "Alpha"]);
    await expect.poll(() => bars().elements()).toHaveLength(2);
    await gone(panel());
  });

  test("at phone width a bar's panel lies over the roadmap", async () => {
    await page.viewport(390, 800);
    await renderWithBoard(<BoardShell initialTask={null} />, versions());

    await bars().first().click();
    await expect.element(panel()).toBeVisible();
    await says(panel(), "No task is under Beta.");
    const box = panel().element().getBoundingClientRect();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(overflow()).toBe(0);
    await panel().getByRole("button", { name: "Close Beta" }).click();
    await gone(panel());
  });
});
