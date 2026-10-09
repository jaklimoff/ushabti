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
    await expect(card.getByTestId("project-column")).toHaveText([
      "Todo 2",
      "In Progress 1",
      "Ready 0",
      "Shipped 1",
    ]);
    const bar = card.getByTestId("project-bar");
    await expect(bar.locator("[data-column]")).toHaveCount(3);
    await expect(bar.locator('[data-column="Todo"]')).toHaveCSS(
      "background-color",
      "rgb(154, 160, 170)",
    );
    await expect(card.getByTestId("project-folded")).toHaveCount(0);
    await expect(card.getByTestId("project-agents")).toHaveText("1 agent working");
    await expect(card.getByTestId("project-last")).toHaveText(
      `just now · ${me.name} · ${key}-${shipped.number}`,
    );

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

    await page.goto("/projects");
    const card = page.locator(`a[href="/p/${projectId}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("project-columns")).toHaveCount(0);
    await expect(card.getByTestId("project-bar")).toHaveCount(0);
    await expect(card.getByTestId("project-waiting")).toHaveCount(0);
  });
});
