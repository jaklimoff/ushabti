import { expect, test, type Page } from "@playwright/test";
import {
  addListView,
  card,
  createProject,
  gotoSettings,
  listRow,
  propertyBox,
  register,
  saved,
  unique,
} from "./helpers";

type Property = {
  id: string;
  name: string;
  type: string;
  config: { when?: { propertyId: string; optionIds: string[] } };
  options: { id: string; name: string }[];
};
type Board = { properties: Property[]; views: { id: string; isDefault: boolean }[] };

async function board(page: Page, projectId: string): Promise<Board> {
  return (await page.request.get(`/api/projects/${projectId}/board`)).json();
}

/** A project with a Type select of Bug and Story, and the read board. */
async function typed(page: Page, name: string) {
  const projectId = await createProject(page, unique(name));
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Type", type: "select", options: ["Bug", "Story"] },
  });
  expect(made.ok()).toBeTruthy();
  const read = await board(page, projectId);
  const of = (n: string) => read.properties.find((p) => p.name === n)!;
  const type = of("Type");
  const option = (n: string) => type.options.find((o) => o.name === n)!.id;
  return { projectId, read, of, type, bug: option("Bug"), story: option("Story") };
}

/*
 * "Severity, shown when Type is Bug": a task draws only the properties that
 * apply to it. Priority stands in for Severity, because it is on the card and
 * in the list of a new project already.
 */
test.describe("A property says when it shows", () => {
  test("it is in the panel, on the card and in the list for a Bug, and absent for a Story", async ({
    page,
  }) => {
    await register(page);
    const { projectId, of, type, bug, story } = await typed(page, "When");
    const priority = of("Priority");
    const urgent = priority.options.find((o) => o.name === "Urgent")!.id;
    const status = of("Status");
    const todo = status.options.find((o) => o.name === "Todo")!.id;
    for (const [title, kind] of [
      ["A bug", bug],
      ["A story", story],
    ]) {
      const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
        data: { title, values: { [status.id]: todo, [type.id]: kind, [priority.id]: urgent } },
      });
      expect(res.ok()).toBeTruthy();
    }
    expect(
      (
        await page.request.patch(`/api/properties/${priority.id}`, {
          data: { when: { propertyId: type.id, optionIds: [bug] } },
        })
      ).ok(),
    ).toBeTruthy();

    await page.goto(`/p/${projectId}`);
    await expect(
      card(page, "A bug").locator('[data-testid="card-chip"][title="Priority · Urgent"]'),
    ).toBeVisible();
    await expect(
      card(page, "A story").locator('[data-testid="card-chip"][title="Priority · Urgent"]'),
    ).toHaveCount(0);

    await card(page, "A bug").click();
    await expect(page.locator('[data-property="Priority"]')).toBeVisible();
    await expect(page.locator('[data-property="Type"]')).toBeVisible();
    await page.getByRole("button", { name: "Close task" }).click();
    await card(page, "A story").click();
    await expect(page.locator('[data-property="Type"]')).toBeVisible();
    await expect(page.locator('[data-property="Priority"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Close task" }).click();

    await addListView(page, "Rows");
    await expect(listRow(page, "A bug").getByText("Urgent")).toBeVisible();
    await expect(listRow(page, "A story")).toBeVisible();
    await expect(listRow(page, "A story").getByText("Urgent")).toHaveCount(0);
  });

  test("Settings says the rule in words and clears it with one press", async ({ page }) => {
    await register(page);
    const { projectId, of, type, bug, story } = await typed(page, "When words");
    const priority = of("Priority");

    await gotoSettings(page, projectId);
    const box = propertyBox(page, "Priority");
    await box.getByRole("button", { name: "Shown when…" }).click();
    /* Picking a select asks the question; it writes nothing yet. */
    await box.getByLabel("Shown when of Priority").selectOption({ label: "Type" });
    /* A new rule counts what it hides before it writes, so the box ticks
       once the write is out. */
    await saved(page, () => box.getByLabel("Bug", { exact: true }).click());
    await expect(box.getByLabel("Bug", { exact: true })).toBeChecked();
    await saved(page, () => box.getByLabel("Story", { exact: true }).check());
    await expect(box.getByTestId("when-said")).toHaveText("Shown when Type is Bug or Story");

    await page.reload();
    await expect(propertyBox(page, "Priority").getByTestId("when-said")).toHaveText(
      "Shown when Type is Bug or Story",
    );
    expect(
      (await board(page, projectId)).properties.find((p) => p.id === priority.id)?.config,
    ).toMatchObject({ when: { propertyId: type.id, optionIds: [bug, story] } });

    await saved(page, () =>
      propertyBox(page, "Priority").getByRole("button", { name: "Always show Priority" }).click(),
    );
    await expect(propertyBox(page, "Priority").getByTestId("when-said")).toHaveCount(0);
    await expect(
      propertyBox(page, "Priority").getByRole("button", { name: "Shown when…" }),
    ).toBeVisible();
    expect(
      (await board(page, projectId)).properties.find((p) => p.id === priority.id)?.config.when,
    ).toBeUndefined();
  });

  test("only an admin, and only a person, sets it, and a value it cannot read is a 400", async ({
    page,
    browser,
  }) => {
    const memberPage = await (await browser.newContext()).newPage();
    const member = await register(memberPage, "Bob Member");
    await register(page, "Olga Owner");
    const { projectId, of, type, bug, story } = await typed(page, "When rights");
    const as = page.request;
    expect(
      (await as.post(`/api/projects/${projectId}/members`, { data: { email: member.email } })).ok(),
    ).toBeTruthy();
    const made = await as.post(`/api/projects/${projectId}/agents`, { data: { name: "Helper" } });
    const agentId = ((await made.json()) as { agent: { id: string } }).agent.id;
    const issued = await as.post(`/api/projects/${projectId}/agents/${agentId}/tokens`, {
      data: { name: "when" },
    });
    const secret = ((await issued.json()) as { secret: string }).secret;
    const asAgent = { Authorization: `Bearer ${secret}` };

    const priority = of("Priority");
    const url = `/api/properties/${priority.id}`;
    const rule = { propertyId: type.id, optionIds: [bug] };
    const when = async () =>
      (await board(page, projectId)).properties.find((p) => p.id === priority.id)?.config.when;

    expect((await as.patch(url, { headers: asAgent, data: { when: rule } })).status()).toBe(403);
    const byMember = await memberPage.request.patch(url, { data: { when: rule } });
    expect(byMember.status()).toBe(403);
    expect((await byMember.json()).error).toMatch(/owner or an admin/);
    expect(await when()).toBeUndefined();

    const labels = of("Labels");
    for (const bad of [
      "Bug",
      { propertyId: type.id },
      { propertyId: type.id, optionIds: [] },
      { propertyId: type.id, optionIds: ["not-an-option"] },
      { propertyId: priority.id, optionIds: [priority.options[0].id] },
      { propertyId: labels.id, optionIds: [labels.options[0]?.id ?? "x"] },
      { propertyId: "00000000-0000-4000-8000-000000000000", optionIds: [bug] },
    ]) {
      expect((await as.patch(url, { data: { when: bad } })).status()).toBe(400);
    }
    expect(await when()).toBeUndefined();

    expect((await as.patch(url, { data: { when: rule } })).ok()).toBeTruthy();
    expect(await when()).toEqual(rule);
    /* A token reads the rule as the board reads it. */
    const read: Board = await (
      await as.get(`/api/projects/${projectId}/board`, { headers: asAgent })
    ).json();
    expect(read.properties.find((p) => p.id === priority.id)?.config.when).toEqual(rule);

    /* Type shown when Priority is Urgent would close a circle with the rule
       above, and a task with neither value could set neither. */
    const urgent = priority.options.find((o) => o.name === "Urgent")!.id;
    const circle = await as.patch(`/api/properties/${type.id}`, {
      data: { when: { propertyId: priority.id, optionIds: [urgent] } },
    });
    expect(circle.status()).toBe(400);
    expect((await circle.json()).error).toMatch(/circle/);

    /* Two parts of the config in one request keep both. */
    const status = of("Status");
    const both = { propertyId: type.id, optionIds: [story] };
    expect(
      (await as.patch(`/api/properties/${status.id}`, { data: { dated: true, when: both } })).ok(),
    ).toBeTruthy();
    expect(
      (await board(page, projectId)).properties.find((p) => p.id === status.id)?.config,
    ).toMatchObject({ dated: true, when: both });

    /* Delete Bug and the rule reads as always shown, with nothing cleaned. */
    expect((await as.delete(`/api/options/${bug}`)).ok()).toBeTruthy();
    expect(await when()).toBeUndefined();

    expect((await as.patch(url, { data: { when: null } })).ok()).toBeTruthy();
    expect(await when()).toBeUndefined();

    await memberPage.context().close();
  });
});
