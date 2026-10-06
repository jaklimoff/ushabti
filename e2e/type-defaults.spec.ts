import { expect, test, type Page } from "@playwright/test";
import { addTask, card, column, createProject, gotoSettings, register, unique } from "./helpers";

type Property = {
  id: string;
  name: string;
  type: string;
  config: { defaults?: Record<string, unknown> };
  options: { id: string; name: string }[];
};
type Board = {
  project: { typeBy: string | null };
  properties: Property[];
  views: { id: string; isDefault: boolean }[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
};

async function board(page: Page, projectId: string): Promise<Board> {
  return (await page.request.get(`/api/projects/${projectId}/board`)).json();
}

/** A project typed by Bug and Story, where a Bug starts with Severity Minor. */
async function typed(page: Page) {
  const projectId = await createProject(page, unique("Starts as"));
  const add = async (data: object) => {
    const made = await page.request.post(`/api/projects/${projectId}/properties`, { data });
    expect(made.ok()).toBeTruthy();
    return ((await made.json()) as { property: Property }).property;
  };
  await add({ name: "Type", type: "select", options: ["Bug", "Story"] });
  await add({ name: "Severity", type: "select", options: ["Minor", "Major"] });
  await add({ name: "Owner", type: "person" });
  const read = await board(page, projectId);
  const of = (n: string) => read.properties.find((p) => p.name === n)!;
  const optionOf = (p: Property, n: string) => p.options.find((o) => o.name === n)!.id;
  const type = of("Type");
  const severity = of("Severity");
  const bug = optionOf(type, "Bug");
  const story = optionOf(type, "Story");
  const minor = optionOf(severity, "Minor");
  const major = optionOf(severity, "Major");
  expect(
    (await page.request.patch(`/api/projects/${projectId}`, { data: { typeBy: type.id } })).ok(),
  ).toBeTruthy();
  const rule = await page.request.patch(`/api/properties/${severity.id}`, {
    data: { when: { propertyId: type.id, optionIds: [bug] } },
  });
  expect(rule.ok()).toBeTruthy();
  const set = await page.request.patch(`/api/properties/${severity.id}`, {
    data: { defaults: { [bug]: minor } },
  });
  expect(set.ok()).toBeTruthy();
  return { projectId, read, of, type, severity, bug, story, minor, major };
}

async function created(page: Page, projectId: string, values: Record<string, unknown>) {
  const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title: unique("Task"), values },
  });
  expect(res.status()).toBe(201);
  const { task } = (await res.json()) as {
    task: { id: string; values: Record<string, unknown> };
  };
  const stored = (await board(page, projectId)).tasks.find((t) => t.id === task.id)!.values;
  // The answer is all a caller has to draw the new task from.
  expect(task.values).toEqual(stored);
  return stored;
}

test.describe("What a new task of a type starts with", () => {
  test("a create with only the type gets the default; a sent value wins", async ({ page }) => {
    await register(page);
    const { projectId, type, severity, bug, story, minor, major } = await typed(page);

    expect((await created(page, projectId, { [type.id]: bug }))[severity.id]).toBe(minor);
    expect(
      (await created(page, projectId, { [type.id]: bug, [severity.id]: major }))[severity.id],
    ).toBe(major);
    expect(
      (await created(page, projectId, { [type.id]: bug, [severity.id]: null }))[severity.id] ??
        null,
    ).toBeNull();
    expect((await created(page, projectId, {}))[severity.id]).toBeUndefined();
    expect((await created(page, projectId, { [type.id]: story }))[severity.id]).toBeUndefined();
  });

  test("a default its property's own rule hides is never written", async ({ page }) => {
    await register(page);
    const { projectId, type, severity, story, minor } = await typed(page);
    const onStory = await page.request.patch(`/api/properties/${severity.id}`, {
      data: { defaults: { [story]: minor } },
    });
    expect(onStory.ok()).toBeTruthy();
    // Severity shows only on a Bug, so a Story never carries it.
    expect((await created(page, projectId, { [type.id]: story }))[severity.id]).toBeUndefined();
  });

  test("a person, a stranger type and a value that does not read are refused", async ({ page }) => {
    await register(page);
    const { projectId, of, severity, bug } = await typed(page);
    const owner = of("Owner");
    const members = (await (await page.request.get(`/api/projects/${projectId}/board`)).json())
      .members as { id: string }[];
    const person = await page.request.patch(`/api/properties/${owner.id}`, {
      data: { defaults: { [bug]: members[0].id } },
    });
    expect(person.status()).toBe(400);
    const stranger = await page.request.patch(`/api/properties/${severity.id}`, {
      data: { defaults: { "00000000-0000-0000-0000-000000000000": severity.options[0].id } },
    });
    expect(stranger.status()).toBe(400);
    const junk = await page.request.patch(`/api/properties/${severity.id}`, {
      data: { defaults: { [bug]: "not an option" } },
    });
    expect(junk.status()).toBe(400);
  });

  test("deleting the value or the type reads as no default, with no error", async ({ page }) => {
    await register(page);
    const first = await typed(page);
    expect((await page.request.delete(`/api/options/${first.minor}`)).ok()).toBeTruthy();
    let sev = (await board(page, first.projectId)).properties.find(
      (p) => p.id === first.severity.id,
    )!;
    expect(sev.config.defaults).toBeUndefined();
    expect(
      (await created(page, first.projectId, { [first.type.id]: first.bug }))[first.severity.id],
    ).toBeUndefined();

    const second = await typed(page);
    expect((await page.request.delete(`/api/options/${second.bug}`)).ok()).toBeTruthy();
    sev = (await board(page, second.projectId)).properties.find(
      (p) => p.id === second.severity.id,
    )!;
    expect(sev.config.defaults).toBeUndefined();
  });

  test("a task made in the Bug column says what it starts with, then carries it", async ({
    page,
  }) => {
    await register(page);
    const { projectId, read, type, severity, minor } = await typed(page);
    const main = read.views.find((v) => v.isDefault)!;
    await page.request.patch(`/api/views/${main.id}`, { data: { groupById: type.id } });
    await page.goto(`/p/${projectId}`);

    await column(page, "Bug").getByRole("button", { name: "Add a task to Bug" }).first().click();
    await expect(column(page, "Bug")).toContainText("starts with Severity Minor");
    await page.keyboard.press("Escape");
    await column(page, "Story")
      .getByRole("button", { name: "Add a task to Story" })
      .first()
      .click();
    await expect(column(page, "Story")).not.toContainText("starts with");
    await page.keyboard.press("Escape");

    await addTask(page, "Bug", "A crash");
    await expect(card(page, "A crash")).toBeVisible();
    /* This tab hears no bell for its own create, so only the answer of the
       create can put the default on the card it draws. */
    await expect(card(page, "A crash")).toContainText("Minor");
    const task = (await board(page, projectId)).tasks.find((t) => t.title === "A crash")!;
    expect(task.values[severity.id]).toBe(minor);
  });

  test("an admin sets what a type starts as on the Types page", async ({ page }) => {
    await register(page);
    const { projectId, severity, bug, major } = await typed(page);
    await gotoSettings(page, projectId, "types");
    const row = page
      .getByTestId("type-sheet")
      .getByTestId("type-row")
      .filter({ has: page.getByText("Severity", { exact: true }) });
    const starts = row.getByTestId("starts-as");
    await expect(starts).toContainText("Starts as");
    await expect(starts.getByRole("button", { name: "Minor" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const saved = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/properties/${severity.id}`) && res.request().method() === "PATCH",
    );
    await starts.getByRole("button", { name: "Major" }).click();
    expect((await saved).ok()).toBeTruthy();
    const sev = (await board(page, projectId)).properties.find((p) => p.id === severity.id)!;
    expect(sev.config.defaults).toEqual({ [bug]: major });
    // A person has no Starts as.
    const owner = page
      .getByTestId("type-sheet")
      .getByTestId("type-row")
      .filter({ has: page.getByText("Owner", { exact: true }) });
    await expect(owner.getByTestId("starts-as")).toHaveCount(0);
  });
});

/*
 * A number or text box on the Types page is a settings row that holds words,
 * so a blur saves it and a tab closed on it sends the same save. What the next
 * page reads is the proof; see `useSaveOnLeave`.
 */
test.describe("A Starts as box", () => {
  test("saves on blur, and on a tab closed while it has the focus", async ({ page }) => {
    await register(page);
    const { projectId, bug } = await typed(page);
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Points", type: "number" },
    });
    const { property: points } = (await made.json()) as { property: Property };
    const startsOf = async (p: Page) =>
      (await board(p, projectId)).properties.find((q) => q.id === points.id)!.config.defaults;

    await gotoSettings(page, projectId, "types");
    const box = page
      .getByTestId("type-sheet")
      .getByTestId("type-row")
      .filter({ has: page.getByText("Points", { exact: true }) })
      .getByTestId("starts-as")
      .getByRole("textbox");
    await box.fill("3");
    const saved = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/properties/${points.id}`) && res.request().method() === "PATCH",
    );
    await box.blur();
    expect((await saved).ok()).toBeTruthy();
    expect(await startsOf(page)).toEqual({ [bug]: 3 });

    // The box still has the focus. Closing the tab here is the lost edit.
    await box.fill("5");
    const context = page.context();
    await page.close();
    const next = await context.newPage();
    await expect.poll(() => startsOf(next), { timeout: 20_000 }).toEqual({ [bug]: 5 });

    // An emptied box owes a clear, and a closed tab sends it too.
    await gotoSettings(next, projectId, "types");
    const again = next
      .getByTestId("type-sheet")
      .getByTestId("type-row")
      .filter({ has: next.getByText("Points", { exact: true }) })
      .getByTestId("starts-as")
      .getByRole("textbox");
    await expect(again).toHaveValue("5");
    await again.fill("");
    await next.close();
    const last = await context.newPage();
    await expect.poll(() => startsOf(last), { timeout: 20_000 }).toBeUndefined();
  });
});
