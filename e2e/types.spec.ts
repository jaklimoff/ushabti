import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, register, settles, unique } from "./helpers";

type Property = {
  id: string;
  name: string;
  type: string;
  config: { when?: { propertyId: string; optionIds: string[] } };
  options: { id: string; name: string }[];
};
type Board = { project: { typeBy: string | null }; properties: Property[] };

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
  return { projectId, of, type, bug: option("Bug"), story: option("Story") };
}

function typeRow(page: Page, name: string) {
  return page
    .getByTestId("type-sheet")
    .getByTestId("type-row")
    .filter({ has: page.getByText(name, { exact: true }) });
}

test.describe("The Types page", () => {
  test("the project names a select as its Type, and only a select", async ({ page }) => {
    await register(page);
    const { projectId, type } = await typed(page, "Type by");

    expect((await board(page, projectId)).project.typeBy).toBeNull();
    const notes = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Notes", type: "text" },
    });
    const { property: text } = (await notes.json()) as { property: Property };
    const notSelect = await page.request.patch(`/api/projects/${projectId}`, {
      data: { typeBy: text.id },
    });
    expect(notSelect.status()).toBe(400);
    const unknown = await page.request.patch(`/api/projects/${projectId}`, {
      data: { typeBy: "00000000-0000-0000-0000-000000000000" },
    });
    expect(unknown.status()).toBe(400);

    const set = await page.request.patch(`/api/projects/${projectId}`, {
      data: { typeBy: type.id },
    });
    expect(set.ok()).toBeTruthy();
    expect((await board(page, projectId)).project.typeBy).toBe(type.id);

    // A deleted select reads as no Type, with nothing cleaned up.
    expect((await page.request.delete(`/api/properties/${type.id}`)).ok()).toBeTruthy();
    expect((await board(page, projectId)).project.typeBy).toBeNull();

    const cleared = await page.request.patch(`/api/projects/${projectId}`, {
      data: { typeBy: "" },
    });
    expect(cleared.ok()).toBeTruthy();
  });

  test("an admin picks the Type, opens a type and moves a property on and off it", async ({
    page,
  }) => {
    await register(page);
    const { projectId, of, type, story } = await typed(page, "Types page");
    const priority = of("Priority");
    const urgent = priority.options.find((o) => o.name === "Urgent")!.id;
    const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "A story", values: { [type.id]: story, [priority.id]: urgent } },
    });
    expect(made.ok()).toBeTruthy();

    await gotoSettings(page, projectId, "types");
    const nav = page.getByRole("navigation", { name: "Settings sections" });
    await expect(nav.getByRole("link", { name: /^Types/ })).toHaveText("Types0");
    await page.getByLabel("Types come from").selectOption({ label: "Type" });
    const types = page.getByRole("group", { name: "Types" });
    await expect(types.getByRole("button")).toHaveText(["Bug", "Story"]);
    await expect(nav.getByRole("link", { name: /^Types/ })).toHaveText("Types2");

    // Bug opens first. Priority is on every type; limiting it asks with the count.
    const row = typeRow(page, "Priority");
    await row.getByRole("button", { name: "Only on Bug" }).click();
    const ask = row.getByTestId("when-confirm");
    await expect(ask).toContainText("1 task loses its Priority.");
    // The question belongs to Bug: another type drops it, and coming back asks afresh.
    await types.getByRole("button", { name: "Story" }).click();
    await expect(row.getByRole("button", { name: "Only on Story" })).toBeVisible();
    await expect(ask).toHaveCount(0);
    await types.getByRole("button", { name: "Bug" }).click();
    await row.getByRole("button", { name: "Only on Bug" }).click();
    await expect(ask).toContainText("1 task loses its Priority.");
    await settles(page, /\/api\/properties\/[0-9a-f-]+$/, () =>
      ask.getByRole("button", { name: "Yes, hide" }).click(),
    );
    await expect(row).toContainText("Only on Bug. Change it on the Properties page.");
    await expect(row.getByTestId("type-act").getByRole("button")).toHaveCount(0);

    // On Story it is on another type, and adding it hides nothing, so nothing asks.
    await types.getByRole("button", { name: "Story" }).click();
    await expect(row).toContainText("on Bug");
    await settles(page, /\/api\/properties\/[0-9a-f-]+$/, () =>
      row.getByRole("button", { name: "Add to Story" }).click(),
    );
    await expect(row).toContainText("also on Bug");
    let rule = (await board(page, projectId)).properties.find((p) => p.id === priority.id)!;
    expect(rule.config.when?.optionIds.sort()).toEqual(
      [type.options[0].id, type.options[1].id].sort(),
    );

    await settles(page, /\/api\/properties\/[0-9a-f-]+$/, () =>
      row.getByRole("button", { name: "Take off Story" }).click(),
    );
    await expect(row).toContainText("on Bug");
    rule = (await board(page, projectId)).properties.find((p) => p.id === priority.id)!;
    expect(rule.config.when?.optionIds).toEqual([type.options[0].id]);

    // A new type is a new option of the select.
    await page.getByLabel("New type name").fill("Chore");
    await page.getByRole("button", { name: "Add type" }).click();
    await expect(types.getByRole("button")).toHaveText(["Bug", "Story", "Chore"]);
    const after = await board(page, projectId);
    expect(after.properties.find((p) => p.id === type.id)!.options.map((o) => o.name)).toEqual([
      "Bug",
      "Story",
      "Chore",
    ]);
  });

  test("a property ruled by another select reads its rule and cannot be changed here", async ({
    page,
  }) => {
    await register(page);
    const { projectId, of, type } = await typed(page, "Types ruled");
    const status = of("Status");
    const todo = status.options.find((o) => o.name === "Todo")!.id;
    const ruled = await page.request.patch(`/api/properties/${of("Priority").id}`, {
      data: { when: { propertyId: status.id, optionIds: [todo] } },
    });
    expect(ruled.ok()).toBeTruthy();
    await page.request.patch(`/api/projects/${projectId}`, { data: { typeBy: type.id } });

    await gotoSettings(page, projectId, "types");
    const row = typeRow(page, "Priority");
    await expect(row).toContainText("Shown when Status is Todo");
    await expect(row.getByTestId("type-act").getByRole("button")).toHaveCount(0);
  });

  test("with no Type, the page says what a type is and offers the selects", async ({ page }) => {
    await register(page);
    const { projectId } = await typed(page, "Types none");
    await gotoSettings(page, projectId, "types");
    await expect(page.getByText(/A type is an option of one select/)).toBeVisible();
    const picker = page.getByLabel("Types come from");
    await expect(picker).toHaveValue("");
    await expect(picker.locator("option")).toContainText([
      "No select",
      "Status",
      "Priority",
      "Type",
    ]);
    await expect(page.getByTestId("type-sheet")).toHaveCount(0);
  });
});
