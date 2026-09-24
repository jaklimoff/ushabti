import { expect, test, type Locator } from "@playwright/test";
import {
  addTask,
  column,
  createProject,
  dragOnto,
  forAFinger,
  gotoSettings,
  overflow,
  propertyBox,
  register,
  saved,
  settles,
  unique,
  viewRowOrder,
} from "./helpers";

test.describe("Settings", () => {
  test("an unknown email is invited, and joins as it signs up", async ({ page, browser }) => {
    await register(page, "Owner Person");
    const projectId = await createProject(page, unique("Invites"));
    const email = `${unique("guest").toLowerCase().replace(/\s+/g, "-")}@example.com`;

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Email of the new member").fill(email);
    await page.getByRole("button", { name: "Add member" }).click();

    // No account yet, so the email waits, and the way to send the link is right there.
    const invite = page.getByTestId("invite-row").filter({ hasText: email });
    await expect(invite).toBeVisible();
    await expect(invite.getByText("invited")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy the sign-up link" })).toBeVisible();

    // A wrong address is refused before it is remembered.
    await page.getByLabel("Email of the new member").fill("not an address");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("That email address does not look correct.")).toBeVisible();

    // The guest signs up with that email, in another browser, and is in.
    const other = await browser.newContext();
    const guest = await other.newPage();
    await guest.goto("/register");
    await guest.getByLabel("Your name").fill("Guest Person");
    await guest.getByLabel("Your email").fill(email);
    await guest.getByLabel("Your password").fill("password-123");
    await guest.getByRole("button", { name: "Create account" }).click();
    await guest.waitForURL(/\/projects$/);
    await guest.goto(`/p/${projectId}`);
    await expect(guest.getByText("Invites", { exact: false }).first()).toBeVisible();
    await other.close();

    // The owner's page follows: the invite is a member now.
    await expect(invite).toBeHidden();
    await expect(page.getByText("Guest Person")).toBeVisible();

    // An invite can be withdrawn, and the row asks first.
    const second = `${unique("second").toLowerCase().replace(/\s+/g, "-")}@example.com`;
    await page.getByLabel("Email of the new member").fill(second);
    await page.getByRole("button", { name: "Add member" }).click();
    const secondRow = page.getByTestId("invite-row").filter({ hasText: second });
    await expect(secondRow).toBeVisible();
    await secondRow.getByRole("button", { name: `Withdraw the invite for ${second}` }).click();
    await page.getByRole("button", { name: "Yes, withdraw" }).click();
    await expect(secondRow).toBeHidden();
  });

  test("each section has its own address", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Rail"));

    await page.goto(`/p/${projectId}/settings`);
    await expect(page).toHaveURL(/\/settings\/properties$/);

    await page.getByRole("link", { name: /^People/ }).click();
    await expect(page).toHaveURL(/\/settings\/people$/);
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

    await page.getByRole("link", { name: /^Views/ }).click();
    await expect(page).toHaveURL(/\/settings\/views$/);
  });

  test("a view made in the strip is deleted from settings, which makes none", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Views"));

    await page.getByRole("button", { name: "New view" }).click();
    await page.getByLabel("Name of the new view").fill("By assignee");
    await page.getByRole("button", { name: "Assignee" }).click();
    await page.getByRole("button", { name: "Create view" }).click();
    await expect(page.getByTestId("view-pill").filter({ hasText: "By assignee" })).toBeVisible();

    await gotoSettings(page, projectId, "views");
    await expect(page.getByLabel("Name of the view By assignee")).toBeVisible();
    // One act has one place: the + in the strip. Settings only arranges views.
    await expect(page.getByLabel("Name of the new view")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add view" })).toHaveCount(0);

    await page.getByRole("button", { name: "Delete the view By assignee" }).click();
    await expect(page.getByText(/Delete the view By assignee\?/)).toBeVisible();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page.getByLabel("Name of the view By assignee")).toHaveCount(0);
  });

  test("a view is dragged into its place, and stays there", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("ViewOrder"));

    await gotoSettings(page, projectId, "views");
    expect(await viewRowOrder(page)).toEqual(["BOARD", "PHASES"]);

    await dragOnto(
      page,
      page.getByRole("button", { name: "Reorder the view Phases" }),
      page.getByLabel("Name of the view Board"),
      /^\/api\/views\/[0-9a-f-]+$/,
    );
    expect(await viewRowOrder(page)).toEqual(["PHASES", "BOARD"]);

    // The order is one order, so the strip above the board reads the same.
    await page.goto(`/p/${projectId}`);
    expect(
      (await page.getByTestId("view-pill").allInnerTexts()).map((t) => t.trim().toUpperCase()),
    ).toEqual(["PHASES", "BOARD"]);
  });

  test("the keyboard moves a view as well as the pointer", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("ViewKeys"));

    await gotoSettings(page, projectId, "views");
    await page.getByRole("button", { name: "Reorder the view Board" }).focus();

    // Space lifts the row, the arrows move it, Space puts it down.
    await page.keyboard.press("Space");
    // dnd-kit measures the rows after the lift, so the first arrow needs the
    // frame that comes with it.
    await page.waitForTimeout(120);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(120);
    await page.keyboard.press("Space");

    await expect.poll(async () => viewRowOrder(page)).toEqual(["PHASES", "BOARD"]);
  });

  test("another view is made the main one, and the board opens on it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("MainView"));

    await gotoSettings(page, projectId, "views");
    // The main view carries the word and cannot be deleted; the other one
    // carries the way to take the word from it.
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete the view Board" })).toHaveCount(0);

    await saved(page, () =>
      page.getByRole("button", { name: "Make Phases the main view" }).click(),
    );

    // One view is main, so the word moved rather than spread.
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Make Phases the main view" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete the view Board" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete the view Phases" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toBeVisible();

    // Nobody has picked a view in this browser, so the board opens on the main
    // one: the Phase columns, and not the Status ones.
    await page.goto(`/p/${projectId}`);
    await expect(column(page, "PoC")).toBeVisible();
  });

  test("changing the project key warns about the tasks it renames", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Keys"));

    await page.goto(`/p/${projectId}`);
    await page.getByRole("button", { name: "Add a task to Todo" }).first().click();
    const input = page.getByPlaceholder("What needs doing?");
    await input.fill("Named after the key");
    await input.press("Enter");
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "project");
    await page.getByLabel("Project key", { exact: true }).fill("ZZZ");
    await expect(page.getByText(/1 task is called .*today/)).toBeVisible();
  });

  test("the project delete asks for the key", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Doomed"));

    await gotoSettings(page, projectId, "project");
    await page.getByRole("button", { name: "Delete project" }).click();

    const go = page.getByRole("button", { name: "Delete for good" });
    await expect(go).toBeDisabled();

    const key = await page.getByLabel("Project key", { exact: true }).inputValue();
    await page.getByLabel("Type the project key to confirm").fill(key);
    await expect(go).toBeEnabled();
    await go.click();
    await page.waitForURL("**/projects");
  });

  test("the delete row counts the values, and the board read does not", async ({ page }) => {
    await register(page, "Owner Person");
    const projectId = await createProject(page, unique("Counting"));
    await addTask(page, "Todo", "One task with a status");

    /* The count used to ride on every board read. Nothing carries it now, so
       the daily read no longer pays for a number the owner reads once. */
    const board = await page.request.get(`/api/projects/${projectId}/board`);
    expect(board.ok()).toBeTruthy();
    expect(await board.json()).not.toHaveProperty("valueCounts");

    /* Pressing the row asks for it, and the question names what it found.
       Dropping the task in Todo wrote one Status value.

       The count is held on the wire here, because the moment worth testing is
       the one a fast machine never shows: the question is on screen and does
       not yet name its cost. It must not be answerable in that moment. */
    await gotoSettings(page, projectId, "properties");
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/api\/properties\/[^/]+\/count$/, async (route) => {
      await held;
      await route.continue();
    });

    const box = propertyBox(page, "Status");
    await box.getByRole("button", { name: "Delete the property Status" }).click();

    const yes = page.getByRole("button", { name: "Yes, delete" });
    await expect(page.getByText("Delete Status? Counting what goes with it…")).toBeVisible();
    await expect(yes).toBeDisabled();

    release();
    await expect(yes).toBeEnabled();
    await expect(page.getByText("Delete Status? 5 options and 1 value go with it.")).toBeVisible();
    await page.unroute(/\/api\/properties\/[^/]+\/count$/);
  });

  test("deleting an option asks first, and names the tasks that lose it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Option"));
    await addTask(page, "Todo", "Holds urgent");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "properties");
    const box = propertyBox(page, "Priority");
    const chipOf = box.getByLabel("Name of the option Urgent");

    await box.getByRole("button", { name: "Delete the option Urgent" }).click();
    await expect(page.getByText("Delete Urgent? 1 task loses it.")).toBeVisible();

    // Nothing goes until the question is answered.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(chipOf).toBeVisible();

    await box.getByRole("button", { name: "Delete the option Urgent" }).click();
    await saved(page, () => page.getByRole("button", { name: "Yes, delete" }).click());
    await expect(chipOf).toHaveCount(0);

    // An option nobody holds says so, rather than a count of nought.
    await box.getByRole("button", { name: "Delete the option Low" }).click();
    await expect(page.getByText("Delete Low? No task holds it.")).toBeVisible();
  });

  test("an option count names its own option, and counts a label list", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Late count"));
    await addTask(page, "Todo", "Holds bug and ux");
    await page.getByRole("button", { name: "Close task" }).click();

    /* A multi-select holds its options in a list, so the count reads the list. */
    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const labels = board.properties.find((p: { name: string }) => p.name === "Labels");
    const idOf = (name: string) =>
      labels.options.find((o: { name: string }) => o.name === name).id as string;
    const task = board.tasks.find((t: { title: string }) => t.title === "Holds bug and ux");
    const wrote = await page.request.put(`/api/tasks/${task.id}/values/${labels.id}`, {
      data: { value: [idOf("bug"), idOf("ux")] },
    });
    expect(wrote.ok()).toBeTruthy();

    /* The first count is held, and the person moves on to another option before
       it lands. The late answer must not name the second option's cost. */
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    await page.route(/\/api\/options\/[^/]+\/count$/, async (route) => {
      if (first) {
        first = false;
        await held;
      }
      await route.continue();
    });

    await gotoSettings(page, projectId, "properties");
    const box = propertyBox(page, "Labels");
    await box.getByRole("button", { name: "Delete the option feature" }).click();
    await expect(page.getByText("Delete feature? Counting the tasks that hold it…")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await box.getByRole("button", { name: "Delete the option ux" }).click();
    await expect(page.getByText("Delete ux? 1 task loses it.")).toBeVisible();

    const late = page.waitForResponse(/\/api\/options\/[^/]+\/count$/);
    release();
    await late;
    await expect(page.getByText("Delete ux? 1 task loses it.")).toBeVisible();
    await expect(page.getByText(/^Delete feature\?/)).toHaveCount(0);
    await page.unroute(/\/api\/options\/[^/]+\/count$/);
  });

  test("a new board says where its columns come from", async ({ page }) => {
    await register(page);
    await createProject(page, unique("First"));

    await expect(page.getByText(/every field on a task is yours to rename/i)).toBeVisible();

    await page.getByRole("button", { name: "Add a task to Todo" }).first().click();
    const input = page.getByPlaceholder("What needs doing?");
    await input.fill("Now it is a real board");
    await input.press("Enter");
    await page.getByRole("button", { name: "Close task" }).click();

    // It is guidance for an empty board, not furniture.
    await expect(page.getByText(/every field on a task is yours to rename/i)).toHaveCount(0);
    await expect(column(page, "Todo")).toBeVisible();
  });
});

test.describe("Settings on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("the views page fits the screen and keeps its names whole", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Pocket"));

    await gotoSettings(page, projectId, "views");
    await expect(page.getByRole("heading", { name: "Views" })).toBeVisible();
    expect(await viewRowOrder(page)).toEqual(["BOARD", "PHASES"]);

    expect(await overflow(page)).toBe(0);
    await whole(page.locator('input[aria-label^="Name of the view"]'), 2);
    await forAFinger(page.getByRole("button", { name: /^Reorder the view / }), 2);
  });

  test("the properties page fits the screen, down to the option marks", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Pocket"));

    await gotoSettings(page, projectId, "properties");
    await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
    // Seven properties of the new project, five of them with options.
    await expect(page.getByTestId("property-box")).toHaveCount(7);

    expect(await overflow(page)).toBe(0);
    await whole(page.locator('input[aria-label$=" property"]'), 7);
    await forAFinger(page.getByRole("button", { name: /^Move / }), 7);
    await forAFinger(page.getByRole("button", { name: /^Colour of / }), 24);
    await forAFinger(page.getByRole("button", { name: /^Delete the option / }), 24);
  });
});

/*
 * A field saves on blur, and a tab closed on a focused field sends no blur.
 * The save goes out on the way off the page instead, so the words are there
 * when the person comes back.
 *
 * What the next page draws is the whole proof. The request itself cannot be
 * counted: a page that is going does not report it, however it is watched;
 * see `useSaveOnLeave`.
 */
test.describe("An edit the tab was closed on", () => {
  test("the time zone is saved although nothing was blurred", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Leaving"));

    await gotoSettings(page, projectId, "project");
    const label = "The time zone this project's day is worked out in";
    const zone = page.getByLabel(label);
    await expect(zone).toBeVisible();
    await zone.fill("Europe/Berlin");

    // The box still has the focus. Closing the tab here is the lost edit.
    const context = page.context();
    await page.close();

    const next = await context.newPage();
    await expect
      .poll(
        async () => {
          await next.goto(`/p/${projectId}/settings/project`);
          return next.getByLabel(label).inputValue();
        },
        { timeout: 20_000 },
      )
      .toBe("Europe/Berlin");
  });

  /*
   * A box mirrors what is saved, and the mirror goes stale the moment another
   * tab changes it. Leaving on that mirror would put the old words back, which
   * is not a lost edit being saved but a saved edit being lost.
   */
  test("a tab that typed nothing writes nothing back", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Quiet"));

    await gotoSettings(page, projectId, "project");
    const label = "Project name";
    await expect(page.getByLabel(label)).toBeVisible();

    // The other tab renames the project, and this one hears about it.
    const context = page.context();
    const other = await context.newPage();
    await other.goto(`/p/${projectId}/settings/project`);
    const renamed = unique("Renamed");
    const box = other.getByLabel(label);
    await box.fill(renamed);
    await settles(other, /^\/api\/projects\/[0-9a-f-]+$/, () => box.blur());

    /* The bar of this tab, and not the answer to its board read: a test that
       waits for the response can pass on a slow commit with no gate at all,
       because the tab is still holding the name it was born with. */
    await expect(page.getByTestId("project-switcher")).toHaveAccessibleName(renamed);

    // Nobody typed in this tab, so closing it writes nothing.
    await page.close();
    await other.waitForTimeout(2_000);
    await other.reload();
    await expect(other.getByLabel(label)).toHaveValue(renamed);
  });
});

/* The bar over settings carries the same name as the board's, so it keeps it
   at the same width. */
test.describe("Settings on a small tablet", () => {
  test.use({ viewport: { width: 560, height: 820 } });

  test("the bar keeps the person's name", async ({ page }) => {
    const account = await register(page);
    const projectId = await createProject(page, unique("Pocket"));

    await gotoSettings(page, projectId, "views");
    const person = page.getByTestId("user-name");
    await expect(person).toBeVisible();
    await expect(person).toHaveText(account.name);
    expect(await overflow(page)).toBe(0);
  });
});

/**
 * Every box draws the whole of its own text.
 *
 * A box narrower than its text scrolls inside itself, so the name ends in
 * nothing — which a screenshot of a short name never shows. The count is
 * named because an empty list would otherwise measure nothing and pass.
 */
async function whole(boxes: Locator, count: number) {
  await expect(boxes).toHaveCount(count);
  for (const box of await boxes.all()) {
    const read = await box.evaluate((el) => {
      const input = el as HTMLInputElement;
      return { text: input.value, cut: input.scrollWidth - input.clientWidth };
    });
    expect(read.cut, `"${read.text}" is cut off by ${read.cut} px`).toBeLessThanOrEqual(0);
  }
}
