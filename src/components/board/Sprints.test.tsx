import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { ViewsPanel } from "@/components/settings/ViewsPanel";
import type { BoardData, PropertyDTO } from "@/lib/types";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * A sprint on the board: the header of one past its end, a shipped one that
 * leaves every choice, and the picker that opens on the current one. Each
 * test was a test of the end to end spec its block names, and carries its
 * name or says which half it is. What Close, Unship and the board read write
 * is `sprint-route.test.ts`.
 */

const byTestId = (id: string) => page.getByTestId(id);
const column = (name: string) =>
  byTestId("column").filter({
    has: byTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });
const card = (title: string) =>
  byTestId("board-canvas").getByTestId("card").filter({ hasText: title });
const gone = (locator: Locator) => expect.element(locator).not.toBeInTheDocument();
const text = (locator: Locator) => locator.query()?.textContent ?? "";
/** One property's field on the task panel, asked for afresh each time. */
const fieldOf = (name: string) =>
  page.elementLocator(
    document.querySelector(`[data-testid="task-panel"] [data-property="${name}"]`)!,
  );
const names = () =>
  byTestId("column-name")
    .elements()
    .map((e) => e.textContent?.trim());

afterEach(() => page.viewport(1440, 900));

/** The day `offset` days from the board's today, 2026-10-08. */
function day(offset: number): string {
  const at = new Date(Date.UTC(2026, 9, 8) + offset * 86_400_000);
  return at.toISOString().slice(0, 10);
}

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

/** An iteration named Sprint with these options, and the main view grouped by it when asked. */
function withIteration(
  data: BoardData,
  options: ReturnType<typeof option>[],
  { grouped = true, name = "Sprint", type = "iteration" as PropertyDTO["type"] } = {},
): PropertyDTO {
  const property: PropertyDTO = {
    id: crypto.randomUUID(),
    name,
    type,
    position: "z",
    config: type === "select" ? { dated: true } : { cadence: { length: 14 } },
    options,
  };
  data.properties.push(property);
  if (grouped) data.views.find((v) => v.isDefault)!.groupById = property.id;
  return property;
}

/* ---- e2e/ended-sprint.spec.ts -------------------------------------------- */

describe("A sprint past its end", () => {
  /* The screen halves of "the header says how long ago it ended, and Close
     makes the next sprint" and "Unship reopens an ended sprint, and nothing
     closes it again": an open sprint a week past its end says so, and still
     offers Close. An unshipped one is an open one; the route test unships. */
  test("the header says how long ago it ended, and offers Close", async () => {
    const data = newProject();
    withIteration(data, [option("Sprint 1", "a", { startAt: day(-20), targetAt: day(-7) })]);
    withTask(data, "Alpha", { Sprint: "Sprint 1" });
    await renderWithBoard(<BoardShell initialTask={null} />, data);

    const header = column("Sprint 1");
    await expect.element(header.getByTestId("column-date")).toHaveTextContent("Ended 7 days ago");
    await expect
      .element(header.getByTestId("column-date"))
      .toHaveAttribute("title", `Target ${day(-7)}`);
    await expect.element(header.getByRole("button", { name: "Close Sprint 1" })).toBeVisible();
  });

  test("an ended header leaves the name readable with the sum, archive and Close showing", async () => {
    const data = newProject();
    withIteration(data, [option("Sprint 1", "a", { startAt: day(-26), targetAt: day(-12) })]);
    const points: PropertyDTO = {
      id: crypto.randomUUID(),
      name: "Points",
      type: "number",
      position: "y",
      config: {},
      options: [],
    };
    data.properties.push(points);
    data.project.progressBy = points.id;
    withTask(data, "Alpha", { Sprint: "Sprint 1" });
    await renderWithBoard(<BoardShell initialTask={null} />, data);

    const header = column("Sprint 1");
    /* Twelve days is the longest the words usually run; a sum needs a number. */
    await expect.element(header.getByTestId("column-date")).toHaveTextContent("Ended 12 days ago");
    await expect.element(header.getByTestId("column-sum")).toBeVisible();
    await expect.element(header.getByTestId("column-archive")).toBeVisible();
    await expect.element(header.getByTestId("column-ship")).toBeVisible();

    const room = headerRoom(header.element());
    expect(room.past).toBe(0);
    expect(room.nameCut).toBeLessThanOrEqual(0);
  });
});

/** How far the header's parts run past the column, and how much of the name is cut. */
function headerRoom(el: Element) {
  const head = el.querySelector('[class*="colHead"]') ?? el;
  const edge = (el.closest('[data-testid="column"]') ?? el).getBoundingClientRect().right;
  const name = head.querySelector('[data-testid="column-name"]') as HTMLElement;
  let past = 0;
  for (const child of head.querySelectorAll("*")) {
    const at = child.getBoundingClientRect();
    if (at.width > 0) past = Math.max(past, at.right - edge);
  }
  return { past: Math.max(Math.round(past), 0), nameCut: name.scrollWidth - name.clientWidth };
}

/* ---- e2e/shipped-iteration.spec.ts --------------------------------------- */

describe("A shipped option on the board", () => {
  test("a shipped sprint leaves the board, the picker and the filter list, and stays on its task", async () => {
    const data = newProject();
    const sprint = withIteration(
      data,
      [
        option("S1", "a", { targetAt: day(-1), shippedAt: day(-1) }),
        option("S2", "b"),
        option("S3", "c"),
      ],
      { grouped: false },
    );
    withTask(data, "Old work", { Sprint: "S1" });
    withTask(data, "New work");
    const first = await renderWithBoard(<BoardShell initialTask={null} />, data);

    /* ---- the card still names its sprint ------------------------------- */

    await expect.poll(() => text(card("Old work"))).toMatch(/S1/);
    await first.screen.unmount();

    /* ---- no column for it ---------------------------------------------- */

    data.views.find((v) => v.isDefault)!.groupById = sprint.id;
    const { sent } = await renderWithBoard(
      <BoardShell initialTask={null} />,
      data,
      serving(data).answer,
    );
    await expect.poll(names).toEqual(["S2", "S3", "No open sprint"]);
    expect(column("No open sprint").getByTestId("card").elements()).toHaveLength(2);

    /* ---- the picker offers the open ones, plus the one a task holds ----- */

    /* An iteration's picker is a menu, so it can open on the current sprint. */
    const offered = () =>
      fieldOf("Sprint")
        .getByRole("option")
        .elements()
        .map((e: Element) => e.textContent?.match(/^S\d/)?.[0])
        .filter(Boolean);
    await card("Old work").click();
    await fieldOf("Sprint").getByRole("button", { name: /S1/ }).click();
    await expect.poll(offered).toEqual(["S1", "S2", "S3"]);
    await expect
      .element(fieldOf("Sprint").getByRole("option").filter({ hasText: /^S1/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    await card("New work").click();
    await fieldOf("Sprint").getByRole("button").first().click();
    await expect.poll(offered).toEqual(["S2", "S3"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");

    /* ---- the filter keeps it behind one fold ---------------------------- */

    await byTestId("filter-button").click();
    await byTestId("filter-search").fill("Sprint");
    await userEvent.keyboard("{Enter}");
    const rows = page.getByRole("option");
    await gone(rows.filter({ hasText: /^S1/ }));
    await expect.element(rows.filter({ hasText: /^S2/ })).toBeVisible();
    const fold = rows.filter({ hasText: "Shipped" });
    await expect.poll(() => text(fold)).toMatch(/1/);
    await fold.click();
    await expect.element(rows.filter({ hasText: /^S1/ })).toBeVisible();
    /* A search reaches behind the fold without opening it. */
    await fold.click();
    await byTestId("filter-box").fill("S1");
    await expect.element(rows.filter({ hasText: /^S1/ })).toBeVisible();

    /* A report on the old sprint keeps the column its cards live in. */
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => sent("PUT", /\/lens$/).length).toBe(1);
    await userEvent.keyboard("{Escape}");
    await expect.poll(names).toEqual(["No open sprint"]);
    await expect.element(card("Old work")).toBeVisible();
    await gone(card("New work"));
  });

  /* The board half of "a shipped version of a dated select is drawn exactly
     as before". Settings is `settings/Sprints.test.tsx`. */
  test("a shipped version of a dated select is drawn exactly as before", async () => {
    const data = newProject();
    withIteration(
      data,
      [
        option("V1", "a", { targetAt: day(-1), shippedAt: day(-1) }),
        option("V2", "b"),
        option("V3", "c"),
      ],
      { name: "Version", type: "select" },
    );
    withTask(data, "Released work");
    await renderWithBoard(<BoardShell initialTask={null} />, data, serving(data).answer);
    await expect.element(column("V1")).toBeVisible();

    await card("Released work").click();
    await expect.element(byTestId("task-panel")).toBeVisible();
    await expect
      .poll(() =>
        fieldOf("Version")
          .getByRole("button")
          .elements()
          .map((e: Element) => e.textContent?.trim()),
      )
      .toEqual(["V1", "V2", "V3"]);
  });
});

/* ---- e2e/iteration.spec.ts ----------------------------------------------- */

describe("The current sprint", () => {
  /* The screen half of "a picker opens on the current sprint, and grouping by
     one starts on 'is current'". The rule the route adds, and the lens that
     keeps it out, are `sprint-route.test.ts`; the rule itself `filters.test.ts`. */
  test("a picker opens on the current sprint, and grouping by one starts on 'is current'", async () => {
    const data = newProject();
    // Old is shipped by hand: a sprint past its end stays open until somebody ships it.
    const sprint = withIteration(
      data,
      [
        option("Old", "a", { startAt: day(-10), targetAt: day(-4), shippedAt: day(-4) }),
        option("Now", "b", { startAt: day(-3), targetAt: day(3) }),
        option("Next", "c", { startAt: day(4), targetAt: day(10) }),
      ],
      { grouped: false },
    );
    withTask(data, "Alpha", { Sprint: "Old" });
    withTask(data, "Bravo", { Sprint: "Now" });
    const first = await renderWithBoard(
      <BoardShell initialTask={null} />,
      data,
      serving(data).answer,
    );

    /* ---- the picker marks the current sprint and opens on it ---------- */

    await card("Alpha").click();
    await expect.element(byTestId("task-panel")).toBeVisible();
    await fieldOf("Sprint").getByRole("button", { name: /Old/ }).click();
    await expect
      .poll(() => text(fieldOf("Sprint").getByRole("option", { name: /Now/ })))
      .toMatch(/current/);
    await expect
      .poll(() => text(fieldOf("Sprint").getByRole("option", { name: /Next/ })))
      .not.toMatch(/current/);
    await expect
      .poll(() => document.querySelector('[data-property="Sprint"] [data-at="true"]')?.textContent)
      .toMatch(/Now/);
    await userEvent.keyboard("{Escape}");
    await first.screen.unmount();

    /* ---- grouping by it adds "is current" in the same write ----------- */

    const settings = await renderWithBoard(<ViewsPanel />, data);
    const select = page.getByLabelText("Grouping property of the view Board");
    const list = select.element().getAttribute("aria-controls");
    await select.click();
    await page
      .elementLocator(document.getElementById(list!)!)
      .getByRole("option", { name: "Sprint", exact: true })
      .click();
    await expect.poll(() => settings.sent("PATCH", /^\/api\/views\//).length).toBe(1);
    expect(settings.sent("PATCH", /^\/api\/views\//)[0].body).toMatchObject({
      groupById: sprint.id,
    });
    await settings.screen.unmount();

    /* The board the server answers then: the chip, and only the current sprint. */
    const main = data.views.find((v) => v.isDefault)!;
    main.groupById = sprint.id;
    main.filters = { rules: [{ propertyId: sprint.id, op: "is", values: ["__current__"] }] };
    await renderWithBoard(<BoardShell initialTask={null} />, data);
    await expect
      .element(byTestId("filter-chip").filter({ hasText: "Sprint is current" }))
      .toBeVisible();
    await expect.element(card("Bravo")).toBeVisible();
    await gone(card("Alpha"));
  });
});
