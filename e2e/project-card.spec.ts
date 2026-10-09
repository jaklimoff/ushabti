import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

type Option = { id: string; name: string };
type Property = { id: string; name: string; options: Option[] };
type View = { id: string; isDefault: boolean };

async function connectAgent(page: Page, projectId: string, name: string): Promise<string> {
  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill(name);
  await page.getByRole("button", { name: "Add agent" }).click();
  const box = page.getByTestId("agent-box").filter({ hasText: name });
  await box.getByRole("button", { name: "Connect" }).click();
  await box.getByRole("button", { name: "Make token" }).click();
  const token = (
    (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
  ).trim();
  expect(token).toMatch(/^ush_/);
  return token;
}

async function shapeOf(page: Page, projectId: string) {
  const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const prop = (name: string) =>
    board.properties.find((p: Property) => p.name === name) as Property;
  const main = (board.views as View[]).find((v) => v.isDefault) as View;
  const opt = (p: Property, name: string) => (p.options.find((o) => o.name === name) as Option).id;
  return {
    key: board.project.key as string,
    status: prop("Status"),
    priority: prop("Priority"),
    main,
    opt,
  };
}

/** Starts a run as the agent, and leaves it in the status asked for. */
async function runAs(request: APIRequestContext, token: string, taskId: string, status?: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const started = await request.post(`/api/tasks/${taskId}/run`, { headers, data: { goal: "Go" } });
  expect(started.ok()).toBeTruthy();
  const id = (await started.json()).run.id as string;
  if (status) {
    const moved = await request.patch(`/api/runs/${id}`, { headers, data: { status, step: "?" } });
    expect(moved.ok()).toBeTruthy();
  }
}

test.describe("The project list shows how every project is going", () => {
  test("a card counts its main board, steps folded columns aside and names the last change", async ({
    page,
    request,
  }) => {
    const me = await register(page, "Card Reader");
    const name = unique("Pulse");
    const projectId = await createProject(page, name);
    const { key, status, priority, main, opt } = await shapeOf(page, projectId);
    const token = await connectAgent(page, projectId, "Worker");

    const make = async (title: string, values: Record<string, string>) => {
      const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
        data: { title, values },
      });
      expect(made.ok()).toBeTruthy();
      return (await made.json()).task as { id: string; number: number };
    };
    const at = (s: string, p = "High") => ({
      [status.id]: opt(status, s),
      [priority.id]: opt(priority, p),
    });
    const one = await make("One", at("Todo"));
    const two = await make("Two", at("Todo"));
    const three = await make("Three", at("In Progress"));
    await make("Low, hidden by my lens", at("In Progress", "Low"));
    await make("In the backlog, hidden by the view", at("Backlog"));
    const shipped = await make("Shipped", at("Shipped"));
    const archived = await make("Archived", at("Todo"));
    const deleted = await make("Deleted", at("Todo"));
    expect((await page.request.post(`/api/tasks/${archived.id}/archive`)).ok()).toBeTruthy();
    expect((await page.request.delete(`/api/tasks/${deleted.id}`)).ok()).toBeTruthy();

    /* The view's rule is everybody's; the lens is only mine. */
    const viewRule = { propertyId: status.id, op: "is_not", values: [opt(status, "Backlog")] };
    expect(
      (
        await page.request.patch(`/api/views/${main.id}`, {
          data: { filters: { rules: [viewRule] } },
        })
      ).ok(),
    ).toBeTruthy();
    const lensRule = { propertyId: priority.id, op: "is_not", values: [opt(priority, "Low")] };
    expect(
      (
        await page.request.put(`/api/views/${main.id}/lens`, {
          data: { filters: { rules: [lensRule] } },
        })
      ).ok(),
    ).toBeTruthy();

    // One works, one asks, one hands over.
    await runAs(request, token, one.id);
    await runAs(request, token, two.id, "waiting");
    await runAs(request, token, three.id, "handed_over");

    // The newest change is mine, on the shipped task.
    expect(
      (
        await page.request.put(`/api/tasks/${shipped.id}/values/${priority.id}`, {
          data: { value: opt(priority, "Medium") },
        })
      ).ok(),
    ).toBeTruthy();

    await page.goto("/projects");
    const card = page.locator(`a[href="/p/${projectId}"]`);
    await expect(card.getByTestId("project-waiting")).toHaveText("2 waiting for you");
    /* The grip lies on the colour square and frames it exactly. */
    const keyBox = card.getByText(key, { exact: true });
    await expect(keyBox).toBeVisible();
    const square = await keyBox.boundingBox();
    await card.hover();
    const grip = await page.getByRole("button", { name: `Move the project ${name}` }).boundingBox();
    expect(square && Math.round(square.width)).toBe(22);
    expect(grip).toEqual(square);
    await expect(card.getByTestId("project-column")).toHaveText([
      "Todo 2",
      "In Progress 1",
      "Ready 0",
      "Shipped 1",
    ]);
    const bar = card.getByTestId("project-bar");
    await expect(bar.locator("[data-column]")).toHaveCount(3);
    /* Greys, lighter from the first column to the last, each the shade of its dot. */
    const shade = (el: Element) => getComputedStyle(el).backgroundColor;
    const todo = await bar.locator('[data-column="Todo"]').evaluate(shade);
    const shippedShade = await bar.locator('[data-column="Shipped"]').evaluate(shade);
    expect(todo).not.toBe(shippedShade);
    expect(await card.getByTestId("project-column").first().locator("span").evaluate(shade)).toBe(
      todo,
    );
    await expect(card.getByTestId("project-folded")).toHaveCount(0);
    await expect(card.getByTestId("project-agents")).toHaveText("Worker working");
    await expect(card.getByTestId("project-last")).toHaveCount(0);
    const people = card.getByTestId("project-people");
    await expect(people.getByRole("img", { name: me.name })).toHaveCSS("border-radius", "50%");
    await expect(people.getByRole("img", { name: "Worker" })).toHaveCSS("border-radius", "4px");
    await expect(people.getByRole("img", { name: "Worker" })).toHaveText("WO");

    /* Shipped folded on the main board leaves the bar and reads last, muted. */
    await page.evaluate(
      ([viewId, columnId]) =>
        window.localStorage.setItem(`ushabti:folded:${viewId}`, JSON.stringify([columnId])),
      [main.id, opt(status, "Shipped")],
    );
    await page.reload();
    await expect(card.getByTestId("project-folded")).toHaveText("+ Shipped 1");
    await expect(card.getByTestId("project-column")).toHaveText([
      "Todo 2",
      "In Progress 1",
      "Ready 0",
    ]);
    await expect(bar.locator('[data-column="Shipped"]')).toHaveCount(0);
    await expect(bar.locator("[data-column]")).toHaveCount(2);
  });

  test("a main view that is a list draws no columns, and nothing waits", async ({ page }) => {
    await register(page, "List Reader");
    const projectId = await createProject(page, unique("Listed"));
    const { main } = await shapeOf(page, projectId);
    expect(
      (await page.request.patch(`/api/views/${main.id}`, { data: { kind: "list" } })).ok(),
    ).toBeTruthy();
    expect(
      (
        await page.request.post(`/api/projects/${projectId}/tasks`, {
          data: { title: "A change" },
        })
      ).ok(),
    ).toBeTruthy();

    await page.goto("/projects");
    const card = page.locator(`a[href="/p/${projectId}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("project-columns")).toHaveCount(0);
    await expect(card.getByTestId("project-bar")).toHaveCount(0);
    await expect(card.getByTestId("project-waiting")).toHaveCount(0);
    await expect(card.getByTestId("project-no-columns")).toHaveText(
      "The main view draws no columns.",
    );
    /* Nobody works, so the footer says when it last changed. */
    await expect(card.getByTestId("project-agents")).toHaveCount(0);
    await expect(card.getByTestId("project-last")).toHaveText("just now");
  });

  test("the fourth row counts the last fourteen days, today in the accent", async ({ page }) => {
    await register(page, "Pulse Watcher");
    const projectId = await createProject(page, unique("Pulse"));
    for (const title of ["One", "Two", "Three"]) {
      expect(
        (await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } })).ok(),
      ).toBeTruthy();
    }

    await page.goto("/projects");
    const card = page.locator(`a[href="/p/${projectId}"]`);
    const bars = card.getByTestId("project-day");
    await expect(bars).toHaveCount(14);
    await expect(bars.last()).toHaveAttribute("data-today", "true");
    await expect(bars.first()).not.toHaveAttribute("data-today");
    await expect(card.getByTestId("project-changes")).toHaveText(/^\d+ changes, 14 days$/);
    await expect(
      card.getByRole("img", { name: /changes in 14 days\. The busiest day was today/ }),
    ).toBeVisible();
  });

  test("the second row reads the latest change, then the sprint, then the release", async ({
    page,
  }) => {
    const me = await register(page, "Goal Reader");
    const projectId = await createProject(page, unique("Goal"));
    const { key, status, opt } = await shapeOf(page, projectId);
    const card = page.locator(`a[href="/p/${projectId}"]`);

    /* No activity yet: the row is there and says nothing. */
    await page.goto("/projects");
    await expect(card.getByTestId("project-goal")).toBeEmpty();

    const make = async (title: string, values: Record<string, string>) => {
      const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
        data: { title, values },
      });
      expect(made.ok()).toBeTruthy();
      return (await made.json()).task as { id: string; number: number };
    };
    const task = await make("Cards table keeps the side pane open", {
      [status.id]: opt(status, "Todo"),
    });
    const moved = await page.request.put(`/api/tasks/${task.id}/values/${status.id}`, {
      data: { value: opt(status, "In Progress") },
    });
    expect(moved.ok()).toBeTruthy();
    await page.goto("/projects");
    await expect(card.getByTestId("project-change")).toHaveText(
      `${me.name} moved ${key}-${task.number} Cards table keeps the side pane open→ In Progress`,
    );

    /* Sprints on: the current sprint and the days it has. */
    const sprints = await page.request.post(`/api/projects/${projectId}/sprints`, {
      data: { length: 14 },
    });
    expect(sprints.status()).toBe(201);
    await page.reload();
    await expect(card.getByTestId("project-sprint")).toHaveText(
      /^Sprint .+ · (\d+ days? left|last day)\d+ \/ \d+$/,
    );

    /* Releases on win over sprints, and count done by the project's own rule. */
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Version", type: "select", options: ["0.23"] },
    });
    expect(made.ok()).toBeTruthy();
    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const version = board.properties.find((p: Property) => p.name === "Version") as Property;
    expect(
      (await page.request.patch(`/api/properties/${version.id}`, { data: { dated: true } })).ok(),
    ).toBeTruthy();
    expect((await page.request.post(`/api/projects/${projectId}/releases`)).ok()).toBeTruthy();
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const dated = await page.request.patch(`/api/options/${version.options[0].id}`, {
      data: { startAt: day(-1), targetAt: day(5) },
    });
    expect(dated.ok()).toBeTruthy();
    const doneWhen = await page.request.patch(`/api/projects/${projectId}`, {
      data: { doneWhen: { propertyId: status.id, optionId: opt(status, "Shipped") } },
    });
    expect(doneWhen.ok()).toBeTruthy();
    const put = await page.request.put(`/api/tasks/${task.id}/values/${version.id}`, {
      data: { value: version.options[0].id },
    });
    expect(put.ok()).toBeTruthy();
    await make("Already out", {
      [status.id]: opt(status, "Shipped"),
      [version.id]: version.options[0].id,
    });

    const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
    const target = new Date(`${day(5)}T00:00:00`);
    await page.reload();
    const release = card.getByTestId("project-release");
    await expect(release).toHaveText(
      `Version 0.23 · ships ${months[target.getMonth()]} ${target.getDate()}1 / 2`,
    );
    await expect(card.getByTestId("project-sprint")).toHaveCount(0);
  });
});
