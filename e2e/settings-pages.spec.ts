import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, propertyBox, register, unique } from "./helpers";

/*
 * The settings pages as a person sees them after the design pass: a grouped
 * menu, Project in named cards, People rows that fit a phone, property blocks
 * that say what uses them, and a card view row that rings its part of the
 * preview. The rules themselves are the panel tests; this keeps the pages in
 * front of a reviewer.
 */
test.describe("Settings pages", () => {
  test("the menu groups the pages, and Project reads as named cards", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Pages"));

    await gotoSettings(page, projectId, "project");
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    for (const group of ["General", "Shape", "Integrations"]) {
      await expect(rail.getByRole("group", { name: group })).toBeVisible();
    }
    // The types are ticked on their property, so the menu has no Types page.
    await expect(rail.getByRole("link", { name: "Types", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["General", "Danger zone"]);
    // Sharing holds the public changelog, so it shows once releases are on.
    expect((await page.request.post(`/api/projects/${projectId}/releases`)).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "General",
      "Sharing",
      "Danger zone",
    ]);
    // The agent rules are on People, under the agents.
    await expect(page.getByRole("heading", { name: "Agents", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Agent rules", { exact: true })).toHaveCount(0);
    // Sprints are switched on their property now, on Properties.
    await expect(page.getByRole("heading", { name: "Work", exact: true })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: /sprints/i })).toHaveCount(0);
    await expect(page.getByLabel("Sprint length in days")).toHaveCount(0);
    await expect(page.getByLabel("First day of the first sprint")).toHaveCount(0);

    await page.getByRole("button", { name: "Delete project" }).click();
    await expect(page.getByRole("button", { name: "Delete for good" })).toBeDisabled();
    await expect(page.getByLabel("Type the project key to confirm")).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("seen-project.png"), fullPage: true });
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("the owner hands the project to an admin from the danger zone", async ({
    page,
    browser,
  }, testInfo) => {
    const other = await browser.newContext();
    const heir = await register(await other.newPage(), "Nia Next");
    await other.close();
    await register(page, "Olga Owner");
    const projectId = await createProject(page, unique("Hand"));
    await gotoSettings(page, projectId, "project");
    const pick = page.getByLabel("The admin to hand the project to");
    await expect(pick).toBeDisabled();
    await expect(page.getByText("Make somebody an admin first.")).toBeVisible();

    const added = await page.request.post(`/api/projects/${projectId}/members`, {
      data: { email: heir.email, role: "admin" },
    });
    expect(added.ok()).toBe(true);
    await page.reload();
    await expect(
      page.getByText("The new owner can delete the project. You stay an admin."),
    ).toBeVisible();
    await pick.click();
    await page.getByRole("option", { name: "Nia Next" }).click();
    await expect(page.getByText("Make Nia Next the owner? You become an admin.")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-hand-over.png"), fullPage: true });
    const sent = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && r.url().includes(`/members/`),
    );
    await page.getByRole("button", { name: "Yes, hand it over" }).click();
    expect((await sent).ok()).toBe(true);
    // An admin has no danger zone.
    await expect(page.getByRole("heading", { name: "Danger zone" })).toHaveCount(0);

    // People offers no Owner in a role select.
    await gotoSettings(page, projectId, "people");
    await expect(page.getByText("Owner", { exact: true })).toBeVisible();
  });

  test("People holds the rules for every agent, under the agents", async ({ page }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Rules"));
    await gotoSettings(page, projectId, "people");

    const headings = page.getByRole("heading", { level: 2 });
    await expect(headings).toHaveText(["Members", "Agents", "Rules for every agent"]);
    const box = page.getByLabel("Agent rules", { exact: true });
    const saved = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/projects/${projectId}`),
    );
    await box.fill("Done means merged.");
    await box.blur();
    expect((await saved).ok()).toBe(true);

    await page.reload();
    await expect(box).toHaveValue("Done means merged.");
    await page.screenshot({ path: testInfo.outputPath("seen-people-rules.png"), fullPage: true });
  });

  test("an off role is turned on from its tile on Properties", async ({ page }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Roles"));
    await gotoSettings(page, projectId, "properties");
    const tiles = page.getByTestId("role-strip").getByTestId("role-tile");

    await tiles.nth(0).getByRole("button", { name: "Pick ▾" }).click();
    const menu = page.getByRole("menu", { name: "Which property holds the types?" });
    await expect(menu.getByRole("menuitem", { name: /^Priority/ })).toContainText(
      /Select · \d+ options/,
    );
    await page.screenshot({ path: testInfo.outputPath("seen-role-pick.png"), fullPage: true });
    await menu.getByRole("menuitem", { name: /^Priority/ }).click();
    await expect(tiles.nth(0)).toContainText(/Priority · \d+ types/);
    await expect(page.getByLabel("Name of the Priority property")).toBeFocused();

    await tiles.nth(2).getByRole("button", { name: "Use releases" }).click();
    await expect(tiles.nth(2)).not.toContainText("Not set");

    /* Off is on the property that is the releases, and it asks first. */
    const releases = page.getByRole("group", { name: "The releases" });
    await expect(page.getByText("Ship and the changelog read it.")).toBeVisible();
    await releases.getByRole("switch", { name: "Release is the releases" }).click();
    const question = page.getByRole("alertdialog");
    await expect(question).toHaveAttribute("aria-label", /^Turn releases off\? Nothing is deleted/);
    await page.screenshot({ path: testInfo.outputPath("seen-releases-off.png"), fullPage: true });
    await question.getByRole("button", { name: "Yes, turn off" }).click();
    await expect(tiles.nth(2)).toContainText("Not set");
    await expect(page.getByRole("group", { name: "The releases" })).toHaveCount(0);
    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    expect(board.project.releaseBy).toBeNull();
    await tiles.nth(2).getByRole("button", { name: "Use releases" }).click();
    await expect(tiles.nth(2)).not.toContainText("Not set");

    await tiles.nth(3).getByRole("button", { name: "Use sprints" }).click();
    const form = page.getByRole("form", { name: "Use sprints" });
    await expect(form.getByLabel("Sprint length in days")).toHaveValue("14");
    await page.screenshot({ path: testInfo.outputPath("seen-role-sprints.png"), fullPage: true });
    await form.getByLabel("Sprint length in days").fill("7");
    await form.getByRole("button", { name: "Use sprints" }).click();
    await expect(tiles.nth(3)).toContainText("Sprint · 7 days");
    await page.screenshot({ path: testInfo.outputPath("seen-role-on.png"), fullPage: true });

    /* The sprint property carries its switch and its cadence. */
    const sprints = page.getByRole("group", { name: "The sprints" });
    await expect(sprints.getByText("Close makes the next one.")).toBeVisible();
    const cadence = sprints.getByLabel("Sprint length in days of Sprint");
    await expect(cadence).toHaveValue("7");
    await expect(page.getByLabel("Sprint length in days of Sprint")).toHaveCount(1);
    await cadence.fill("10");
    await cadence.blur();
    await expect(tiles.nth(3)).toContainText("Sprint · 10 days");
    await sprints.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("seen-sprints-panel.png") });

    /* Off asks first, and yes clears the pointer and nothing else. */
    await sprints.getByRole("switch", { name: "Sprint is the sprints" }).click();
    const sprintsOff = page.getByRole("alertdialog");
    await expect(sprintsOff).toHaveAttribute(
      "aria-label",
      /^Turn sprints off\? Nothing is deleted/,
    );
    await page.screenshot({ path: testInfo.outputPath("seen-sprints-off.png") });
    await sprintsOff.getByRole("button", { name: "Yes, turn off" }).click();
    await expect(tiles.nth(3)).toContainText("Not set");
    await expect(page.getByRole("group", { name: "The sprints" })).toHaveCount(0);
    const after = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    expect(after.project.sprintBy).toBeNull();
    /* The iteration keeps its cadence, with no switch. */
    await expect(page.getByLabel("Sprint length in days of Sprint")).toHaveValue("10");
  });

  test("a property says what uses it, and a card view row rings the card", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Uses"));

    await gotoSettings(page, projectId, "properties");
    await expect(propertyBox(page, "Status").getByTestId("property-use")).toHaveText(
      "Columns of Board",
    );
    await expect(page.getByText(/groupable/i)).toHaveCount(0);
    // A new project says done by Status; the other three roles are off.
    const tiles = page.getByTestId("role-strip").getByTestId("role-tile");
    await expect(tiles).toHaveCount(4);
    await expect(tiles.nth(0)).toContainText("Not set");
    await expect(tiles.nth(1)).toContainText("Status is Done");
    await expect(tiles.nth(2)).toContainText("No releases.");
    await expect(tiles.nth(3)).toContainText("No sprints.");
    await expect(propertyBox(page, "Status")).toContainText("Done when");
    await tiles.nth(1).click();
    await expect(page.getByLabel("Name of the Status property")).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("seen-properties.png"), fullPage: true });

    await gotoSettings(page, projectId, "card");
    // The page opens on the card drawn big; a chip under the pointer rings
    // its part of the preview, as a row of the list does.
    await page.getByRole("button", { name: "Priority, header left" }).hover();
    const preview = page.getByRole("complementary", { name: "What a card looks like" });
    await expect(preview.locator("[data-lit]").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-card-view.png") });
  });

  test("dated options read as plain rows, and plain options keep their pills", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Rows"));
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Version", type: "select", options: ["v1", "v2", "v3"] },
    });
    expect(made.ok()).toBeTruthy();
    const { id } = ((await made.json()) as { property: { id: string } }).property;
    expect(
      (await page.request.patch(`/api/properties/${id}`, { data: { dated: true } })).ok(),
    ).toBeTruthy();

    await gotoSettings(page, projectId, "properties");
    const row = (name: string) =>
      page.getByRole("button", { name: `Move the option ${name}` }).locator("..");
    const look = (name: string) =>
      row(name).evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          top: s.borderTopWidth,
          left: s.borderLeftWidth,
          bottom: s.borderBottomWidth,
          line: s.borderBottomColor,
          radius: s.borderTopLeftRadius,
          fill: s.backgroundColor,
        };
      });
    const soft = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--line-soft)";
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });

    await expect(row("v1")).toBeVisible();
    for (const name of ["v1", "v2"]) {
      expect(await look(name)).toEqual({
        top: "0px",
        left: "0px",
        bottom: "1px",
        line: soft,
        radius: "0px",
        fill: "rgba(0, 0, 0, 0)",
      });
    }
    expect((await look("v3")).bottom).toBe("0px");

    // Status carries no dates, so its options stay pills with an outline.
    const pill = await look("Done");
    expect(pill.top).toBe("1px");
    expect(pill.radius).not.toBe("0px");

    await propertyBox(page, "Version").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("seen-dated-rows.png"), fullPage: true });
  });

  test("on a phone the People rows keep their role and their button", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page);
    const projectId = await createProject(page, unique("Phone"));

    await gotoSettings(page, projectId, "people");
    const role = page.getByText("Owner", { exact: true }).first();
    await expect(role).toBeInViewport();
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(width).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath("seen-people-phone.png"), fullPage: true });
  });
});
