import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, propertyBox, register, saved, unique } from "./helpers";

type Page = import("@playwright/test").Page;

type Option = {
  id: string;
  name: string;
  startAt: string | null;
  targetAt: string | null;
  shippedAt: string | null;
  note: string | null;
};
type Board = { properties: { id: string; name: string; type: string; options: Option[] }[] };

async function propertyOf(page: Page, projectId: string, name: string) {
  const board: Board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  return board.properties.find((p) => p.name === name)!;
}

/* Settings draws the boxes only on a property that says its options carry dates. */
async function datesOn(page: Page, projectId: string, name: string) {
  const property = await propertyOf(page, projectId, name);
  const res = await page.request.patch(`/api/properties/${property.id}`, { data: { dated: true } });
  expect(res.ok()).toBeTruthy();
}

async function optionOf(page: Page, projectId: string, property: string, option: string) {
  return (await propertyOf(page, projectId, property)).options.find((o) => o.name === option)!;
}

/*
 * A Version, a Sprint or a Quarter is an option with dates. Nothing on a task
 * changes, so an agent reads them from the board answer it already reads.
 */
test.describe("An option carries a plan", () => {
  test("the option routes take the four, and the board answer carries them", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Plan"));
    const status = await propertyOf(page, projectId, "Status");
    const options = `/api/properties/${status.id}/options`;

    const made = await page.request.post(options, {
      data: { name: "Sprint 4", startAt: "2026-10-01", targetAt: "2026-10-14", note: "**API**" },
    });
    expect(made.status()).toBe(201);
    let sprint = await optionOf(page, projectId, "Status", "Sprint 4");
    expect(sprint).toMatchObject({
      startAt: "2026-10-01",
      targetAt: "2026-10-14",
      shippedAt: null,
      note: "**API**",
    });

    /* An option made without them carries them as null. */
    const todo = await optionOf(page, projectId, "Status", "Todo");
    expect(todo).toMatchObject({ startAt: null, targetAt: null, shippedAt: null, note: null });

    const bad = await page.request.patch(`/api/options/${sprint.id}`, {
      data: { targetAt: "soon" },
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toBe("The target date must be a date like 2026-10-03.");

    /* A target moved alone is read against the start already saved. */
    const early = await page.request.patch(`/api/options/${sprint.id}`, {
      data: { targetAt: "2026-09-30" },
    });
    expect(early.status()).toBe(400);
    expect((await early.json()).error).toBe("The target date cannot be before the start date.");

    const backwards = await page.request.post(options, {
      data: { name: "Sprint 5", startAt: "2026-10-15", targetAt: "2026-10-01" },
    });
    expect(backwards.status()).toBe(400);

    const shipped = await page.request.patch(`/api/options/${sprint.id}`, {
      data: { shippedAt: "2026-10-13", note: null },
    });
    expect(shipped.status()).toBe(200);
    sprint = await optionOf(page, projectId, "Status", "Sprint 4");
    expect(sprint).toMatchObject({ targetAt: "2026-10-14", shippedAt: "2026-10-13", note: null });

    /* The property route and the export send the same option. */
    const property = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Quarter", type: "select", options: ["Q4"] },
    });
    expect((await property.json()).property.options[0]).toMatchObject({
      name: "Q4",
      startAt: null,
      note: null,
    });
    const exported = await (await page.request.get(`/api/projects/${projectId}/export`)).json();
    const out = JSON.stringify(exported);
    expect(out).toContain('"shippedAt":"2026-10-13"');
  });

  test("a multi-select option does not get them", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Labels"));
    await datesOn(page, projectId, "Status");
    const labels = await propertyOf(page, projectId, "Labels");
    expect(labels.type).toBe("multi_select");

    const made = await page.request.post(`/api/properties/${labels.id}/options`, {
      data: { name: "urgent", targetAt: "2026-10-14" },
    });
    expect(made.status()).toBe(400);
    expect((await made.json()).error).toBe(
      "Only an option of a single select carries dates and a note.",
    );

    const [first] = labels.options;
    const patched = await page.request.patch(`/api/options/${first.id}`, {
      data: { note: "no" },
    });
    expect(patched.status()).toBe(400);

    await gotoSettings(page, projectId);
    await expect(propertyBox(page, "Labels").getByLabel(/^Start of /)).toHaveCount(0);
    await expect(
      propertyBox(page, "Status")
        .getByLabel(/^Start of /)
        .first(),
    ).toBeVisible();
  });

  test("Settings saves the start, the target and the note on blur", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Settings plan"));
    await datesOn(page, projectId, "Status");
    await gotoSettings(page, projectId);
    const box = propertyBox(page, "Status");

    for (const [label, day] of [
      ["Start of Todo", "2026-10-01"],
      ["Target of Todo", "2026-10-14"],
    ]) {
      await box.getByLabel(label).fill(day);
      await saved(page, () => box.getByLabel(label).blur());
    }
    const note = box.getByLabel("Note of Todo");
    await note.fill("Ships the API");
    await saved(page, () => note.blur());

    expect(await optionOf(page, projectId, "Status", "Todo")).toMatchObject({
      startAt: "2026-10-01",
      targetAt: "2026-10-14",
      note: "Ships the API",
    });

    /* A target before the start is refused, and the box goes back. */
    await box.getByLabel("Target of Todo").fill("2026-09-01");
    await box.getByLabel("Target of Todo").blur();
    await expect(page.getByTestId("toast")).toContainText("cannot be before the start date");
    await expect(box.getByLabel("Target of Todo")).toHaveValue("2026-10-14");

    /* Emptied, the note is taken away. */
    await note.fill("");
    await saved(page, () => note.blur());
    expect((await optionOf(page, projectId, "Status", "Todo")).note).toBeNull();

    await page.reload();
    await expect(box.getByLabel("Start of Todo")).toHaveValue("2026-10-01");
  });

  test("a date box with one part cleared keeps the saved date", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Half date"));
    await datesOn(page, projectId, "Status");
    const todo = await optionOf(page, projectId, "Status", "Todo");
    await page.request.patch(`/api/options/${todo.id}`, { data: { startAt: "2026-10-01" } });

    await gotoSettings(page, projectId);
    const start = propertyBox(page, "Status").getByLabel("Start of Todo");
    await expect(start).toHaveValue("2026-10-01");
    await expect
      .poll(() => start.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))))
      .toBe(true);

    /* One part cleared: the box answers "" although the day is only half
       gone. That is not an empty box, so nothing is written. */
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH") writes.push(r.url());
    });
    await start.focus();
    await page.keyboard.press("Backspace");
    expect(await start.evaluate((el: HTMLInputElement) => el.validity.badInput)).toBe(true);
    await start.blur();
    await expect(start).toHaveValue("2026-10-01");

    /* Nor when the tab goes with the box half cleared. */
    await start.focus();
    await page.keyboard.press("Backspace");
    await page.goto("about:blank");
    expect(writes).toEqual([]);
    expect((await optionOf(page, projectId, "Status", "Todo")).startAt).toBe("2026-10-01");
  });

  test("a note of many lines keeps its lines through a focus and a blur", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Note lines"));
    await datesOn(page, projectId, "Status");
    const todo = await optionOf(page, projectId, "Status", "Todo");
    const words = "Scope:\n- API\n- UI";
    await page.request.patch(`/api/options/${todo.id}`, { data: { note: words } });

    await gotoSettings(page, projectId);
    const note = propertyBox(page, "Status").getByLabel("Note of Todo");
    await expect(note).toHaveValue(words);
    await expect
      .poll(() => note.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))))
      .toBe(true);
    await note.focus();
    await note.blur();
    /* Shift+Enter makes a line, so a person can write one too. */
    await note.focus();
    await note.evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(el.value.length, el.value.length),
    );
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("- Docs");
    await saved(page, () => note.blur());
    expect((await optionOf(page, projectId, "Status", "Todo")).note).toBe(`${words}\n- Docs`);
  });

  for (const [label, field, words] of [
    ["Start", "startAt", "2026-10-01"],
    ["Target", "targetAt", "2026-10-14"],
    ["Note", "note", "Half typed"],
  ] as const) {
    test(`a ${label.toLowerCase()} still in its box is sent when the tab goes`, async ({
      page,
    }) => {
      await register(page);
      const projectId = await createProject(page, unique("Leave plan"));
      await datesOn(page, projectId, "Status");
      await gotoSettings(page, projectId);

      const box = propertyBox(page, "Status").getByLabel(`${label} of In Progress`);
      /* A fill before React owns the box reaches no handler, so nothing was
         typed in this tab and the leave rightly sends nothing. */
      await expect
        .poll(() => box.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))))
        .toBe(true);
      await box.fill(words);
      await expect(box).toBeFocused();
      await page.goto("about:blank");

      await expect
        .poll(async () => (await optionOf(page, projectId, "Status", "In Progress"))[field])
        .toBe(words);
    });
  }

  test("the shipped date is read only, with one Unship", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Unship"));
    await datesOn(page, projectId, "Status");
    const ready = await optionOf(page, projectId, "Status", "Ready");
    await page.request.patch(`/api/options/${ready.id}`, { data: { shippedAt: "2026-10-02" } });

    await gotoSettings(page, projectId);
    const box = propertyBox(page, "Status");
    await expect(box.getByText("Shipped 2026-10-02")).toBeVisible();
    await expect(box.getByRole("button", { name: /^Unship / })).toHaveCount(1);
    /* Shown, never typed into: there is no box for it. */
    await expect(box.getByLabel(/^Shipped of /)).toHaveCount(0);

    /* The day it shipped cannot be typed back, so the row asks first. */
    await box.getByRole("button", { name: "Unship Ready" }).click();
    await expect(box.getByRole("alertdialog")).toContainText("Unship Ready?");
    await box.getByRole("button", { name: "Cancel" }).click();
    await expect(box.getByText("Shipped 2026-10-02")).toBeVisible();

    await box.getByRole("button", { name: "Unship Ready" }).click();
    await saved(page, () => box.getByRole("button", { name: "Yes, unship" }).click());
    await expect(box.getByText("Shipped 2026-10-02")).toHaveCount(0);
    await expect(box.getByRole("button", { name: /^Unship / })).toHaveCount(0);
    expect((await optionOf(page, projectId, "Status", "Ready")).shippedAt).toBeNull();
  });

  test("only an admin, and only a person, writes the shipped date", async ({ page, browser }) => {
    const adminPage = await (await browser.newContext()).newPage();
    const admin = await register(adminPage, "Ada Admin");
    const memberPage = await (await browser.newContext()).newPage();
    const member = await register(memberPage, "Bob Member");
    await register(page, "Olga Owner");
    const projectId = await createProject(page, unique("Ship rights"));
    await datesOn(page, projectId, "Status");
    const as = page.request;
    for (const email of [admin.email, member.email]) {
      expect(
        (await as.post(`/api/projects/${projectId}/members`, { data: { email } })).ok(),
      ).toBeTruthy();
    }
    const board = await (await as.get(`/api/projects/${projectId}/board`)).json();
    const adaId = (board.members as { id: string; name: string }[]).find(
      (m) => m.name === "Ada Admin",
    )!.id;
    expect(
      (
        await as.patch(`/api/projects/${projectId}/members/${adaId}`, { data: { role: "admin" } })
      ).ok(),
    ).toBeTruthy();
    const made = await as.post(`/api/projects/${projectId}/agents`, { data: { name: "Helper" } });
    const agentId = ((await made.json()) as { agent: { id: string } }).agent.id;
    const issued = await as.post(`/api/projects/${projectId}/agents/${agentId}/tokens`, {
      data: { name: "ship" },
    });
    const secret = ((await issued.json()) as { secret: string }).secret;
    const asAgent = { Authorization: `Bearer ${secret}` };

    const ready = await optionOf(page, projectId, "Status", "Ready");
    const url = `/api/options/${ready.id}`;

    /* A member and a token are refused, with a sentence, and nothing is written. */
    const byMember = await memberPage.request.patch(url, { data: { shippedAt: "2026-10-02" } });
    expect(byMember.status()).toBe(403);
    expect((await byMember.json()).error).toMatch(/owner or an admin/);
    const byAgent = await page.request.patch(url, {
      headers: asAgent,
      data: { shippedAt: "2026-10-02" },
    });
    expect(byAgent.status()).toBe(403);
    expect((await byAgent.json()).error).toMatch(/\.$/);
    expect((await optionOf(page, projectId, "Status", "Ready")).shippedAt).toBeNull();

    /* The owner and an admin ship, and Unship is null. */
    expect((await as.patch(url, { data: { shippedAt: "2026-10-02" } })).ok()).toBeTruthy();
    expect((await optionOf(page, projectId, "Status", "Ready")).shippedAt).toBe("2026-10-02");
    const unshipByMember = await memberPage.request.patch(url, { data: { shippedAt: null } });
    expect(unshipByMember.status()).toBe(403);
    const unshipByAgent = await page.request.patch(url, {
      headers: asAgent,
      data: { shippedAt: null },
    });
    expect(unshipByAgent.status()).toBe(403);
    expect((await optionOf(page, projectId, "Status", "Ready")).shippedAt).toBe("2026-10-02");
    expect((await adminPage.request.patch(url, { data: { shippedAt: null } })).ok()).toBeTruthy();
    expect((await optionOf(page, projectId, "Status", "Ready")).shippedAt).toBeNull();
    expect(
      (await adminPage.request.patch(url, { data: { shippedAt: "2026-10-03" } })).ok(),
    ).toBeTruthy();
    expect((await optionOf(page, projectId, "Status", "Ready")).shippedAt).toBe("2026-10-03");

    /* Without the shipped date, a member and a token write the rest as before. */
    expect(
      (
        await memberPage.request.patch(url, { data: { targetAt: "2026-10-20", note: "Soon" } })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await page.request.patch(url, {
          headers: asAgent,
          data: { startAt: "2026-10-01", color: "#3fb0c8" },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (await adminPage.request.patch(url, { data: { name: "Ready to go" } })).ok(),
    ).toBeTruthy();
    expect(await optionOf(page, projectId, "Status", "Ready to go")).toMatchObject({
      startAt: "2026-10-01",
      targetAt: "2026-10-20",
      shippedAt: "2026-10-03",
      note: "Soon",
    });

    /* An option born shipped is a ship too, on the route that adds one. */
    const status = await propertyOf(page, projectId, "Status");
    const add = `/api/properties/${status.id}/options`;
    const born = { name: "Born shipped", shippedAt: "2026-10-01" };
    expect((await memberPage.request.post(add, { data: born })).status()).toBe(403);
    expect((await page.request.post(add, { headers: asAgent, data: born })).status()).toBe(403);
    expect((await memberPage.request.post(add, { data: { name: "Plain" } })).ok()).toBeTruthy();
    expect((await as.post(add, { data: born })).ok()).toBeTruthy();
    expect((await optionOf(page, projectId, "Status", "Born shipped")).shippedAt).toBe(
      "2026-10-01",
    );

    /* Settings shows a member the shipped date, and no Unship it would be refused. */
    await gotoSettings(memberPage, projectId);
    const memberBox = propertyBox(memberPage, "Status");
    await expect(memberBox.getByText("Shipped 2026-10-03")).toBeVisible();
    await expect(memberBox.getByRole("button", { name: /^Unship / })).toHaveCount(0);
    await gotoSettings(adminPage, projectId);
    await expect(
      propertyBox(adminPage, "Status").getByRole("button", { name: "Unship Ready to go" }),
    ).toHaveCount(1);

    await adminPage.context().close();
    await memberPage.context().close();
  });
});

/*
 * Status and Priority are selects nobody dates, so the boxes wait for the
 * property to say its options carry dates. Off hides them and keeps what
 * they hold.
 */
test.describe("A select says whether its options carry dates", () => {
  test("the switch shows the boxes, and off hides them and keeps the values", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Dated switch"));
    const todo = await optionOf(page, projectId, "Status", "Todo");
    await page.request.patch(`/api/options/${todo.id}`, {
      data: { startAt: "2026-10-01", shippedAt: "2026-10-02" },
    });

    await gotoSettings(page, projectId);
    const box = propertyBox(page, "Status");
    const toggle = box.getByLabel("Options carry dates");
    /* Off by default, and only a select has it. */
    await expect(toggle).not.toBeChecked();
    await expect(propertyBox(page, "Labels").getByLabel("Options carry dates")).toHaveCount(0);
    await expect(box.getByLabel(/^Start of /)).toHaveCount(0);
    await expect(box.getByLabel(/^Note of /)).toHaveCount(0);
    await expect(box.getByRole("button", { name: /^Unship / })).toHaveCount(0);

    await saved(page, () => toggle.check());
    await expect(box.getByLabel("Start of Todo")).toHaveValue("2026-10-01");
    await expect(box.getByLabel("Target of Todo")).toBeVisible();
    await expect(box.getByLabel("Note of Todo")).toBeVisible();
    await expect(box.getByRole("button", { name: "Unship Todo" })).toBeVisible();
    expect(
      ((await propertyOf(page, projectId, "Status")) as { config?: { dated?: boolean } }).config,
    ).toMatchObject({ dated: true });

    await saved(page, () => toggle.uncheck());
    await expect(box.getByLabel(/^Start of /)).toHaveCount(0);
    await page.reload();
    await expect(box.getByLabel("Options carry dates")).not.toBeChecked();
    await expect(box.getByLabel(/^Start of /)).toHaveCount(0);
    expect(await optionOf(page, projectId, "Status", "Todo")).toMatchObject({
      startAt: "2026-10-01",
      shippedAt: "2026-10-02",
    });

    await saved(page, () => box.getByLabel("Options carry dates").check());
    await expect(box.getByLabel("Start of Todo")).toHaveValue("2026-10-01");
  });

  test("only an admin, and only a person, turns it", async ({ page, browser }) => {
    const memberPage = await (await browser.newContext()).newPage();
    const member = await register(memberPage, "Bob Member");
    await register(page, "Olga Owner");
    const projectId = await createProject(page, unique("Dated rights"));
    const as = page.request;
    expect(
      (await as.post(`/api/projects/${projectId}/members`, { data: { email: member.email } })).ok(),
    ).toBeTruthy();
    const made = await as.post(`/api/projects/${projectId}/agents`, { data: { name: "Helper" } });
    const agentId = ((await made.json()) as { agent: { id: string } }).agent.id;
    const issued = await as.post(`/api/projects/${projectId}/agents/${agentId}/tokens`, {
      data: { name: "dated" },
    });
    const secret = ((await issued.json()) as { secret: string }).secret;
    const asAgent = { Authorization: `Bearer ${secret}` };

    const status = await propertyOf(page, projectId, "Status");
    const url = `/api/properties/${status.id}`;
    const dated = async () =>
      ((await propertyOf(page, projectId, "Status")) as { config?: { dated?: boolean } }).config
        ?.dated;

    const byAgent = await as.patch(url, { headers: asAgent, data: { dated: true } });
    expect(byAgent.status()).toBe(403);
    const byMember = await memberPage.request.patch(url, { data: { dated: true } });
    expect(byMember.status()).toBe(403);
    expect((await byMember.json()).error).toMatch(/owner or an admin/);
    expect(await dated()).toBeUndefined();

    const labels = await propertyOf(page, projectId, "Labels");
    expect(
      (await as.patch(`/api/properties/${labels.id}`, { data: { dated: true } })).status(),
    ).toBe(400);
    expect((await as.patch(url, { data: { dated: "yes" } })).status()).toBe(400);

    expect((await as.patch(url, { data: { dated: true } })).ok()).toBeTruthy();
    expect(await dated()).toBe(true);
    /* A token still reads it, as it reads the rest of a property. */
    const read: Board = await (
      await as.get(`/api/projects/${projectId}/board`, { headers: asAgent })
    ).json();
    expect(read.properties.find((p) => p.id === status.id)).toMatchObject({
      config: { dated: true },
    });
    /* A rename leaves the switch where it was. */
    expect((await as.patch(url, { data: { name: "State" } })).ok()).toBeTruthy();
    const renamed = (await propertyOf(page, projectId, "State")) as {
      config?: { dated?: boolean };
    };
    expect(renamed.config?.dated).toBe(true);

    await memberPage.context().close();
  });
});
