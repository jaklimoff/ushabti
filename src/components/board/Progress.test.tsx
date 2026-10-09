import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ProjectPanel } from "@/components/settings/ProjectPanel";
import type { BoardData, PropertyDTO } from "@/lib/types";
import {
  newProject,
  optionOf,
  propertyOf,
  renderWithBoard,
  withTask,
  type Answer,
} from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * The header of a dated column. Each test here was a test of
 * `e2e/progress.spec.ts`, and its name is the name it had there. The sums
 * are in `progress.test.ts`, the refused name and the kept setting in
 * `progress-route.test.ts`. A reload there is the project the fake keeps here.
 */

const byTestId = (id: string) => page.getByTestId(id);
const column = (name: string) =>
  byTestId("column").filter({
    has: byTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });
const gone = (id: ReturnType<typeof byTestId>) => expect.element(id).not.toBeInTheDocument();

afterEach(async () => {
  await page.viewport(1440, 900);
});

/* A project the way the spec made it: Version is the grouping, v1 has a
   target and v3 has shipped; Points is a number. */
function releaseBoard(): BoardData {
  const data = newProject();
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
  data.properties.push(
    {
      id: crypto.randomUUID(),
      name: "Version",
      type: "select",
      position: "a",
      config: {},
      options: [
        option("v1", "a", { targetAt: "2026-10-14" }),
        option("v2", "b", {}),
        option("v3", "c", { targetAt: "2026-09-01", shippedAt: "2026-09-30" }),
      ],
    },
    {
      id: crypto.randomUUID(),
      name: "Points",
      type: "number",
      position: "b",
      config: {},
      options: [],
    },
  );
  const version = propertyOf(data, "Version");
  data.views.find((v) => v.isDefault)!.groupById = version.id;
  data.project.doneWhen = {
    propertyId: propertyOf(data, "Status").id,
    optionIds: [optionOf(data, "Status", "Shipped")],
  };
  withTask(data, "Alpha", { Version: "v1", Status: "Shipped", Points: 13 });
  withTask(data, "Bravo", { Version: "v1", Status: "Shipped", Points: 8 });
  withTask(data, "Charlie", { Version: "v1", Status: "Backlog", Points: 13 });
  withTask(data, "Delta", { Version: "v1", Status: "Shipped" });
  withTask(data, "Echo", { Version: "v3", Status: "Shipped" });
  return data;
}

async function addFilter(property: string, value: string) {
  await byTestId("filter-button").click();
  await byTestId("filter-search").fill(property);
  await userEvent.keyboard("{Enter}");
  await byTestId("filter-box").fill(value);
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard("{Escape}");
  await gone(byTestId("filter-menu"));
}

describe("A dated column reads as a release", () => {
  test("it shows its day and a bar of the tasks that are over, under the filters", async () => {
    await renderWithBoard(<BoardShell initialTask={null} />, releaseBoard());

    const v1 = column("v1");
    await expect.element(v1.getByTestId("column-date")).toHaveTextContent("Oct 14");
    const bar = () => v1.getByTestId("column-progress");
    await expect.element(bar()).toHaveAttribute("aria-valuenow", "3");
    await expect.element(bar()).toHaveAttribute("aria-valuemax", "4");
    await expect.element(bar()).toHaveAttribute("aria-label", "3 of 4 tasks done");
    /* Counting tasks says nothing new in words: the count already says it. */
    await gone(v1.getByTestId("column-sum"));

    /* An option with no date shows nothing new. */
    const v2 = column("v2");
    await gone(v2.getByTestId("column-date"));
    await gone(v2.getByTestId("column-progress"));

    /* A shipped date takes the target's place. */
    const v3 = column("v3");
    await expect.element(v3.getByTestId("column-date")).toHaveTextContent("✓ Sep 30");
    /* One task is one task, not one tasks. */
    await expect
      .element(v3.getByTestId("column-progress"))
      .toHaveAttribute("aria-label", "1 of 1 task done");

    /* The filter narrows both numbers, so the bar agrees with the cards. */
    await addFilter("Status", "Backlog");
    await expect.element(bar()).toHaveAttribute("aria-valuenow", "0");
    await expect.element(bar()).toHaveAttribute("aria-valuemax", "1");
  });

  /* The project route as the page sees it: a saved patch comes back on the
     next read of the board. */
  function projectRoute(data: BoardData): Answer {
    return ({ method, path, body }) => {
      if (method === "PATCH" && /^\/api\/projects\/[0-9a-f-]+$/.test(path)) {
        data.project = { ...data.project, ...(body as object) };
        return { body: { project: data.project } };
      }
    };
  }

  test("counted by a number property, the header says how much in that unit", async () => {
    const data = releaseBoard();
    const { sent } = await renderWithBoard(
      <>
        <ProjectPanel files={false} />
        <BoardShell initialTask={null} />
      </>,
      data,
      projectRoute(data),
    );
    const patches = () => sent("PATCH", /^\/api\/projects\/[0-9a-f-]+$/);
    const v1 = () => column("v1");

    const box = page.getByLabelText("Count progress by");
    await box.click();
    await page.getByRole("option", { name: "Points", exact: true }).click();
    await expect.poll(() => patches().length).toBe(1);
    expect(patches()[0].body).toEqual({ progressBy: propertyOf(data, "Points").id });

    await expect.element(v1().getByTestId("column-sum")).toHaveTextContent("21 of 34");
    await expect
      .element(v1().getByTestId("column-progress"))
      .toHaveAttribute("aria-label", "21 of 34 Points done");

    /* Back to tasks, and the words go. */
    await box.click();
    await page.getByRole("option", { name: "Tasks", exact: true }).click();
    await expect.poll(() => patches().length).toBe(2);
    expect(patches()[1].body).toEqual({ progressBy: null });
    await gone(v1().getByTestId("column-sum"));
  });

  test("the header with its date and sum reads at phone width", async () => {
    await page.viewport(375, 740);
    const data = releaseBoard();
    data.project.progressBy = propertyOf(data, "Points").id;
    await renderWithBoard(<BoardShell initialTask={null} />, data);

    const pill = page.getByRole("button", { name: "Show the column v1" });
    await pill.click();
    const v1 = column("v1");
    const date = v1.getByTestId("column-date");
    const sum = v1.getByTestId("column-sum");
    await expect.element(date).toHaveTextContent("Oct 14");
    await expect.element(sum).toHaveTextContent("21 of 34");
    await expect.element(v1.getByTestId("column-progress")).toBeVisible();
    await expect.element(v1.getByTestId("column-name")).toBeVisible();

    /* Nothing leaves the column: the date and the sum sit inside its edges. */
    const edge = v1.element().getBoundingClientRect();
    for (const part of [date, sum]) {
      const at = part.element().getBoundingClientRect();
      expect(at.left).toBeGreaterThanOrEqual(edge.left);
      expect(at.right).toBeLessThanOrEqual(edge.right);
    }
    const doc = document.documentElement;
    expect(Math.max(doc.scrollWidth - doc.clientWidth, 0)).toBe(0);
  });
});

/*
 * Ship on the same header: who is offered it, and the question it asks. Each
 * test was a test of `e2e/ship.spec.ts` and carries its name. What a ship
 * writes, and who the route refuses, is `release-route.test.ts`; Move stays
 * end to end.
 */

/* The spec's board: grouped by Version, v1 due with three tasks over and one
   not, v2 undated, and v3 the last option, dated, with one of each. */
function shipBoard(): BoardData {
  const data = newProject();
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
    config: { dated: true },
    options: [
      option("v1", "a", { targetAt: "2026-10-14" }),
      option("v2", "b", {}),
      option("v3", "c", { targetAt: "2026-10-14" }),
    ],
  });
  data.views.find((v) => v.isDefault)!.groupById = propertyOf(data, "Version").id;
  data.project.doneWhen = {
    propertyId: propertyOf(data, "Status").id,
    optionIds: [optionOf(data, "Status", "Shipped")],
  };
  withTask(data, "Alpha", { Version: "v1", Status: "Shipped" });
  withTask(data, "Bravo", { Version: "v1", Status: "Shipped" });
  withTask(data, "Charlie", { Version: "v1", Status: "Backlog" });
  withTask(data, "Delta", { Version: "v1", Status: "Shipped" });
  withTask(data, "Echo", { Version: "v3", Status: "Shipped" });
  withTask(data, "Foxtrot", { Version: "v3", Status: "Backlog" });
  return data;
}

const buttons = (name: string) =>
  page
    .getByRole("alertdialog", { name })
    .getByRole("button")
    .elements()
    .map((b) => b.textContent);

describe("Ship on a column", () => {
  test("only a dated column offers it, and it names both numbers", async () => {
    const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, shipBoard());

    // The undated column is on screen, with its own buttons and no Ship.
    const v2 = column("v2");
    await expect.element(v2.getByRole("button", { name: "Fold the column v2" })).toBeVisible();
    await gone(v2.getByTestId("column-ship"));
    await expect.element(column("v1").getByTestId("column-ship")).toBeVisible();
    await expect.element(column("v3").getByTestId("column-ship")).toBeVisible();

    await column("v1").getByRole("button", { name: "Ship v1" }).click();
    // The header becomes the question, so the column is found by it.
    const ask = page.getByRole("alertdialog", { name: "Ship v1" });
    await expect
      .element(ask.getByTestId("ship-confirm"))
      .toHaveTextContent(
        "Ship v1? 3 tasks are over and will be archived. 1 task is not over. What happens to them?",
      );
    expect(buttons("Ship v1")).toEqual([
      "Move to the next option",
      "Leave them",
      "Clear the value",
      "Cancel",
    ]);

    // Cancel asks nothing of the server.
    await ask.getByRole("button", { name: "Cancel" }).click();
    await gone(ask);
    await expect.element(page.getByText("Alpha", { exact: true })).toBeVisible();
    expect(sent("POST", /\/ship$/)).toHaveLength(0);

    // The last option has no next one, so Move is not offered.
    await column("v3").getByRole("button", { name: "Ship v3" }).click();
    await expect.element(page.getByRole("alertdialog", { name: "Ship v3" })).toBeVisible();
    expect(buttons("Ship v3")).toEqual(["Leave them", "Clear the value", "Cancel"]);
  });

  /* The screen half of "Clear takes the value away; Leave keeps it": the
     press sends Clear, and the shipped column folds. What Clear and Leave
     write is the route test. */
  test("Clear sends its word, and the shipped column folds", async () => {
    const data = shipBoard();
    const version = propertyOf(data, "Version");
    const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data, (s) => {
      if (s.method !== "POST" || !s.path.endsWith("/ship")) return;
      version.options[2].shippedAt = "2026-10-09";
      data.tasks = data.tasks.filter((t) => t.title !== "Echo");
      delete data.tasks.find((t) => t.title === "Foxtrot")!.values[version.id];
      return {
        body: { archived: 1, moved: 0, rest: "clear", shippedAt: "2026-10-09" },
      };
    });

    await column("v3").getByRole("button", { name: "Ship v3" }).click();
    await page
      .getByRole("alertdialog", { name: "Ship v3" })
      .getByRole("button", { name: "Clear the value" })
      .click();

    await expect.element(byTestId("column-strip").filter({ hasText: "v3" })).toBeVisible();
    const ships = sent("POST", /\/ship$/);
    expect(ships).toHaveLength(1);
    expect(ships[0].path).toBe(`/api/options/${version.options[2].id}/ship`);
    expect(ships[0].body).toEqual({ rest: "clear" });
  });

  test("a filter or a member's role takes Ship away", async () => {
    const owner = await renderWithBoard(<BoardShell initialTask={null} />, shipBoard());

    /* Under a rule the cards on screen are not the whole column, so the
       numbers in the question would not be the numbers that go. */
    await expect.element(column("v1").getByTestId("column-ship")).toBeVisible();
    await addFilter("Status", "Backlog");
    await expect
      .element(column("v1").getByRole("button", { name: "Fold the column v1" }))
      .toBeVisible();
    await gone(column("v1").getByTestId("column-ship"));
    await owner.screen.unmount();

    // A member sees the dated column and no Ship: the route would refuse it.
    const data = shipBoard();
    data.project = { ...data.project, role: "member" };
    await renderWithBoard(<BoardShell initialTask={null} />, data);
    const v1 = column("v1");
    await expect.element(v1.getByTestId("column-date")).toBeVisible();
    await gone(v1.getByTestId("column-ship"));
  });
});
