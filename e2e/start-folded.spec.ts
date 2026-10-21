import { expect, test, type Page } from "@playwright/test";
import { column, createProject, gotoSettings, register, unique } from "./helpers";

type Option = { id: string; name: string };
type Property = { id: string; name: string; options: Option[] };
type View = { id: string; name: string; isDefault: boolean; startFolded: string[] };

async function boardOf(page: Page, projectId: string) {
  const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const prop = (name: string) =>
    (board.properties as Property[]).find((p) => p.name === name) as Property;
  const status = prop("Status");
  const opt = (name: string) => (status.options.find((o) => o.name === name) as Option).id;
  const view = (name: string) => (board.views as View[]).find((v) => v.name === name) as View;
  return { status, priority: prop("Priority"), opt, view };
}

function folded(page: Page, name: string) {
  return column(page, name).getByTestId("column-strip");
}

async function connectAgent(page: Page, projectId: string): Promise<string> {
  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill("Folder");
  await page.getByRole("button", { name: "Add agent" }).click();
  const box = page.getByTestId("agent-box").filter({ hasText: "Folder" });
  await box.getByRole("button", { name: "Connect" }).click();
  await box.getByRole("button", { name: "Make token" }).click();
  const token = (
    (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
  ).trim();
  expect(token).toMatch(/^ush_/);
  return token;
}

test.describe("A board view can start with columns folded", () => {
  test("a new project's Board starts with Later folded, from the first paint and on Home", async ({
    page,
  }, testInfo) => {
    await register(page, "Fold Starter");
    const name = unique("Folds");
    const projectId = await createProject(page, name);
    const { opt, view } = await boardOf(page, projectId);
    expect(view("Board").startFolded).toEqual([opt("Later")]);
    expect(view("List").startFolded).toEqual([]);

    /* The server's own answer, before any script runs: the strip is drawn. */
    const html = await (await page.request.get(`/p/${projectId}`)).text();
    expect(html).toMatch(/data-testid="column-strip"(?:(?!<\/button>)[\s\S])*>Later</);

    await expect(folded(page, "Later")).toBeVisible();
    await expect(folded(page, "Backlog")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("seen-start-folded-board.png") });

    await page.goto("/projects");
    const card = page.getByTestId("project-card").filter({ hasText: name });
    await expect(card.getByTestId("project-folded")).toHaveText(/Later/);
  });

  test("Settings shows Starts folded on a board only, and a press saves", async ({
    page,
  }, testInfo) => {
    await register(page, "Fold Setter");
    const projectId = await createProject(page, unique("Folds"));
    await gotoSettings(page, projectId, "views");

    await page.getByRole("button", { name: "Open the view List" }).click();
    await expect(page.getByRole("region", { name: "Starts folded of List" })).toHaveCount(0);

    await page.getByRole("button", { name: "Open the view Board" }).click();
    const part = page.getByRole("region", { name: "Starts folded of Board" });
    await expect(part).toBeVisible();
    const chip = (n: string) => part.getByRole("button", { name: n, exact: true });
    await expect(chip("Later")).toHaveAttribute("aria-pressed", "true");
    await expect(chip("Backlog")).toHaveAttribute("aria-pressed", "false");

    const wrote = page.waitForResponse(
      (r) => /\/api\/views\//.test(r.url()) && r.request().method() === "PATCH",
    );
    await chip("Backlog").click();
    expect((await wrote).ok()).toBeTruthy();
    await expect(chip("Backlog")).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: testInfo.outputPath("seen-start-folded-settings.png") });

    const { opt, view } = await boardOf(page, projectId);
    expect(view("Board").startFolded).toEqual([opt("Later"), opt("Backlog")]);

    await page.goto(`/p/${projectId}`);
    await expect(folded(page, "Later")).toBeVisible();
    await expect(folded(page, "Backlog")).toBeVisible();
  });

  test("once a person folds or opens a column, their own folds win", async ({ page }) => {
    await register(page, "Fold Owner");
    const projectId = await createProject(page, unique("Folds"));
    const { opt, view } = await boardOf(page, projectId);
    const board = view("Board");

    /* Opening the one folded column leaves this browser with no folds at all,
       and that is still an answer of its own. */
    await expect(folded(page, "Later")).toBeVisible();
    await folded(page, "Later").click();
    await expect(folded(page, "Later")).toHaveCount(0);

    const set = await page.request.patch(`/api/views/${board.id}`, {
      data: { startFolded: [opt("Later"), opt("Todo")] },
    });
    expect(set.ok()).toBeTruthy();
    await page.reload();
    await expect(column(page, "Todo")).toBeVisible();
    await expect(folded(page, "Todo")).toHaveCount(0);
    await expect(folded(page, "Later")).toHaveCount(0);
  });

  test("a deleted option and a changed grouping drop out, and an agent may not write it", async ({
    page,
    request,
  }) => {
    await register(page, "Fold Reader");
    const projectId = await createProject(page, unique("Folds"));
    const { opt, priority, view } = await boardOf(page, projectId);
    const board = view("Board");
    const token = await connectAgent(page, projectId);

    const asAgent = await request.patch(`/api/views/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { startFolded: [] },
    });
    expect(asAgent.status()).toBe(403);

    const backlog = opt("Backlog");
    expect(
      (
        await page.request.patch(`/api/views/${board.id}`, {
          data: { startFolded: [opt("Later"), backlog] },
        })
      ).ok(),
    ).toBeTruthy();
    expect((await page.request.delete(`/api/options/${backlog}`)).ok()).toBeTruthy();
    expect((await boardOf(page, projectId)).view("Board").startFolded).toEqual([opt("Later")]);

    expect(
      (
        await page.request.patch(`/api/views/${board.id}`, { data: { groupById: priority.id } })
      ).ok(),
    ).toBeTruthy();
    expect((await boardOf(page, projectId)).view("Board").startFolded).toEqual([]);

    /* Back on Status, the saved Later is read again: nothing was cleaned up. */
    expect(
      (
        await page.request.patch(`/api/views/${board.id}`, {
          data: { groupById: (await boardOf(page, projectId)).status.id },
        })
      ).ok(),
    ).toBeTruthy();
    expect((await boardOf(page, projectId)).view("Board").startFolded).toEqual([opt("Later")]);
  });
});
