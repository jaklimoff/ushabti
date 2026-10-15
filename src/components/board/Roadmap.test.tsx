import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import type { BoardData, PropertyDTO } from "@/lib/types";
import { shipQuestion, straysQuestion } from "@/lib/ship";
import {
  detailOf,
  newProject,
  optionOf,
  propertyOf,
  renderWithBoard,
  withTask,
} from "@/test/board";
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
 * The spec's Version select, less Ghost's target: Beta is open around today,
 * Alpha shipped, and Ghost and Someday have no target. The
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
      option("Ghost", "a", {}),
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

  /* A release is made where releases are seen, with Enter, as a column is. */
  describe("a release made on the roadmap", () => {
    const OPTIONS = /^\/api\/properties\/[0-9a-f-]+\/options$/;
    /** Answers the option route as the server does, with the option it made. */
    const made: Parameters<typeof renderWithBoard>[2] = ({ method, path, body }) => {
      if (method !== "POST" || !OPTIONS.test(path)) return;
      const { name, targetAt } = body as { name: string; targetAt: string };
      const option = {
        id: crypto.randomUUID(),
        name,
        color: "#3fb0c8",
        position: "z",
        startAt: null,
        targetAt,
        shippedAt: null,
        note: null,
      };
      return { status: 201, body: { option } };
    };
    const nameBox = () => page.getByRole("textbox", { name: "Name of the release" });
    const targetBox = () => page.getByLabelText("Target date of the release");

    async function addRelease(name: string, target: string) {
      await nameBox().fill(name);
      await targetBox().fill(target);
      await userEvent.keyboard("{Enter}");
    }

    test("a roadmap with no release shows No release yet, and Enter makes one", async () => {
      const data = versions();
      propertyOf(data, "Version").options = [];
      const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data, made);

      await says(byTestId("roadmap-add"), "No release yet");
      expect(rows().elements()).toHaveLength(0);
      const target = plus(data.today, 14);
      await addRelease("1.0", target);

      await expect.poll(() => rows().elements()).toHaveLength(1);
      await says(rows().first(), "1.0");
      const posts = sent("POST", OPTIONS);
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toEqual({ name: "1.0", targetAt: target });
      // The row it drew takes the place of the blank: the next one is added below.
      await says(byTestId("roadmap-add"), "Add a release");
      await expect.element(nameBox()).toHaveValue("");
    });

    test("a roadmap with releases ends with Add a release, for a member too", async () => {
      const data = versions();
      data.project.role = "member";
      const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data, made);

      await expect.poll(() => rows().elements()).toHaveLength(2);
      await says(byTestId("roadmap-add"), "Add a release");
      // A name with no date would draw no row, so Enter asks for the date.
      await nameBox().fill("2.0");
      await userEvent.keyboard("{Enter}");
      await expect.element(targetBox()).toHaveFocus();
      expect(sent("POST", OPTIONS)).toHaveLength(0);

      await targetBox().fill(plus(data.today, 60));
      await userEvent.keyboard("{Enter}");
      await expect.poll(() => rows().elements()).toHaveLength(3);
      await says(rows().filter({ hasText: "2.0" }), "0 of 0");
      expect(sent("POST", OPTIONS)).toHaveLength(1);
    });

    test("a sprint roadmap offers no add row", async () => {
      const data = versions();
      propertyOf(data, "Version").type = "iteration";
      await renderWithBoard(<BoardShell initialTask={null} />, data, made);

      await expect.poll(() => rows().elements()).toHaveLength(2);
      await gone(byTestId("roadmap-add"));
    });
  });

  /*
   * Ship where the release is seen. The question, the answers and the route
   * are the column header's; what a ship writes is `release-route.test.ts`,
   * and the end to end walk is `e2e/ship.spec.ts`.
   */
  describe("Ship on a roadmap row", () => {
    /* Beta holds two tasks that are over and one that is not, and the
       project says Done means done. */
    function shipPlan(): BoardData {
      const data = versions();
      data.project.doneWhen = {
        propertyId: propertyOf(data, "Status").id,
        optionIds: [optionOf(data, "Status", "Done")],
      };
      withTask(data, "Alpha task", { Version: "Beta", Status: "Done" });
      withTask(data, "Bravo task", { Version: "Beta", Status: "Done" });
      withTask(data, "Charlie task", { Version: "Beta", Status: "Backlog" });
      return data;
    }
    const row = (name: string) => rows().filter({ hasText: name });
    const ask = (name: string) => page.getByRole("alertdialog", { name: `Ship ${name}` });
    const answers = (name: string) =>
      ask(name)
        .getByRole("button")
        .elements()
        .map((b) => b.textContent);

    test("an open row offers Ship and asks the column's question; a shipped row offers none", async () => {
      const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, shipPlan());

      await expect.element(row("Beta").getByTestId("roadmap-ship")).toBeVisible();
      await gone(row("Alpha").getByTestId("roadmap-ship"));

      await row("Beta").getByRole("button", { name: "Ship Beta" }).click();
      await expect
        .element(ask("Beta").getByTestId("ship-confirm"))
        .toHaveTextContent(`${shipQuestion("Beta", 2, 1)} What happens to them?`);
      // Someday is the next option, so Move is offered, as on the column.
      expect(answers("Beta")).toEqual([
        "Move to the next option",
        "Leave them",
        "Clear the value",
        "Cancel",
      ]);
      await ask("Beta").getByRole("button", { name: "Cancel" }).click();
      await gone(ask("Beta"));
      expect(sent("POST", /\/ship$/)).toHaveLength(0);
    });

    test("a press sends the column's route, and the shipped row offers no Ship", async () => {
      const data = shipPlan();
      const beta = versionOf(data, "Beta");
      const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data, (s) => {
        if (s.method !== "POST" || !s.path.endsWith("/ship")) return;
        beta.shippedAt = data.today;
        data.tasks = data.tasks.filter((t) => t.title !== "Alpha task" && t.title !== "Bravo task");
        return { body: { archived: 2, moved: 0, rest: "leave", shippedAt: data.today } };
      });

      await row("Beta").getByRole("button", { name: "Ship Beta" }).click();
      await ask("Beta").getByRole("button", { name: "Leave them" }).click();

      await expect.poll(() => sent("POST", /\/ship$/).length).toBe(1);
      const ship = sent("POST", /\/ship$/)[0];
      expect(ship.path).toBe(`/api/options/${beta.id}/ship`);
      expect(ship.body).toEqual({ rest: "leave" });
      await says(row("Beta"), "Shipped");
      await gone(row("Beta").getByTestId("roadmap-ship"));
    });

    test("with no Done when, the row says nothing counts as over and sends no ship", async () => {
      const data = shipPlan();
      data.project.doneWhen = null;
      const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data);

      await row("Beta").getByRole("button", { name: "Ship Beta" }).click();
      await expect
        .element(ask("Beta").getByTestId("ship-confirm"))
        .toHaveTextContent(
          "Nothing counts as over yet. Say which Status means done in Settings → Project.",
        );
      expect(answers("Beta")).toEqual(["Cancel"]);
      await expect
        .element(ask("Beta").getByRole("link", { name: "Open Settings" }))
        .toHaveAttribute("href", `/p/${data.project.id}/settings/project`);
      expect(sent("POST", /\/ship$/)).toHaveLength(0);
    });

    test("a member may ship, and a filter takes Ship away", async () => {
      const data = shipPlan();
      data.project = { ...data.project, role: "member" };
      const member = await renderWithBoard(<BoardShell initialTask={null} />, data);
      await says(row("Beta"), "Beta");
      await expect.element(row("Beta").getByTestId("roadmap-ship")).toBeVisible();
      await member.screen.unmount();

      const filtered = shipPlan();
      filtered.views.find((v) => v.name === "Plan")!.filters = {
        rules: [
          {
            propertyId: propertyOf(filtered, "Status").id,
            op: "is",
            values: [optionOf(filtered, "Status", "Done")],
          },
        ],
      };
      await renderWithBoard(<BoardShell initialTask={null} />, filtered);
      await says(row("Beta"), "Beta");
      await gone(row("Beta").getByTestId("roadmap-ship"));
    });

    /* Golf and Hotel are over and in no release; India is in none and not
       over, and Juliet is over in another. Only the first two are offered. */
    function withStrays(): BoardData {
      const data = shipPlan();
      withTask(data, "Golf task", { Status: "Done" });
      withTask(data, "Hotel task", { Status: "Done" });
      withTask(data, "India task", { Status: "Backlog" });
      withTask(data, "Juliet task", { Version: "Alpha", Status: "Done" });
      return data;
    }
    const tick = (name: string) => ask(name).getByRole("checkbox");

    test("the question counts the over tasks in no release and takes them by default", async () => {
      const data = withStrays();
      const beta = versionOf(data, "Beta");
      const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data, (s) => {
        if (s.method !== "POST" || !s.path.endsWith("/ship")) return;
        return { body: { archived: 4, moved: 0, rest: "leave", shippedAt: data.today, taken: 2 } };
      });

      await row("Beta").getByRole("button", { name: "Ship Beta" }).click();
      await expect
        .element(ask("Beta").getByTestId("ship-confirm"))
        .toHaveTextContent(`${shipQuestion("Beta", 2, 1)} What happens to them?`);
      // The tick carries the sentence, and starts on.
      await expect
        .element(ask("Beta").getByRole("checkbox", { name: straysQuestion(2)! }))
        .toBeChecked();
      await ask("Beta").getByRole("button", { name: "Leave them" }).click();

      await expect.poll(() => sent("POST", /\/ship$/).length).toBe(1);
      const ship = sent("POST", /\/ship$/)[0];
      expect(ship.path).toBe(`/api/options/${beta.id}/ship`);
      expect(ship.body).toEqual({ rest: "leave", strays: true });
    });

    test("with the tick off, the ship leaves them where they were", async () => {
      const { sent } = await renderWithBoard(
        <BoardShell initialTask={null} />,
        withStrays(),
        (s) => {
          if (s.method !== "POST" || !s.path.endsWith("/ship")) return;
          return { body: { archived: 2, moved: 0, rest: "leave", shippedAt: "2026-10-15" } };
        },
      );

      await row("Beta").getByRole("button", { name: "Ship Beta" }).click();
      await tick("Beta").click();
      await expect.element(tick("Beta")).not.toBeChecked();
      await ask("Beta").getByRole("button", { name: "Leave them" }).click();

      await expect.poll(() => sent("POST", /\/ship$/).length).toBe(1);
      expect(sent("POST", /\/ship$/)[0].body).toEqual({ rest: "leave" });
    });

    test("with none in no release, nothing more is said", async () => {
      await renderWithBoard(<BoardShell initialTask={null} />, shipPlan());
      await row("Beta").getByRole("button", { name: "Ship Beta" }).click();
      await expect.element(ask("Beta")).toBeVisible();
      await gone(tick("Beta"));
    });

    test("a sprint close offers nothing", async () => {
      const data = withStrays();
      propertyOf(data, "Version").type = "iteration";
      await renderWithBoard(<BoardShell initialTask={null} />, data);
      await row("Beta").getByRole("button", { name: "Close Beta" }).click();
      const close = page.getByRole("alertdialog", { name: "Close Beta" });
      await expect.element(close).toBeVisible();
      await expect.element(close).not.toHaveTextContent("in no release");
      await gone(close.getByRole("checkbox"));
    });
  });
});
