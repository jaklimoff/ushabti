import { expect, test, type Locator, type Page } from "@playwright/test";
import { addTask, card, createProject, register, saved, unique } from "./helpers";

/** A click on a face saves at once; this waits for the save to answer. */
async function pick(page: Page, face: Locator) {
  const saved = page.waitForResponse(
    (res) => res.url().endsWith("/api/auth/me") && res.request().method() === "PATCH",
  );
  await face.click();
  expect((await saved).status()).toBe(200);
}

test.describe("Your own account", () => {
  test("a name and a colour can be changed, and the board follows", async ({ page }) => {
    const account = await register(page, "Mistyped Nmae");
    const projectId = await createProject(page, unique("Account"));
    await addTask(page, "Todo", "Whose is this");
    await page.getByRole("button", { name: "Close task" }).click();

    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByText(account.email)).toBeVisible();

    const name = page.getByLabel("Your name");
    await name.fill("Ada Lovelace");
    await name.blur();
    await expect(page.getByTestId("toast")).toContainText("Saved.");

    // The palette, not the operating system's colour wheel, and all of it but
    // the grey that reads as nobody.
    const swatches = page.getByRole("radiogroup", { name: "Your colour" }).getByRole("radio");
    await expect(swatches).toHaveCount(11);
    await expect(page.getByRole("radio", { name: "Colour #8b8f98" })).toHaveCount(0);
    const saved = page.waitForResponse(
      (res) => res.url().endsWith("/api/auth/me") && res.request().method() === "PATCH",
    );
    await swatches.nth(10).click();
    await expect(swatches.nth(10)).toHaveAttribute("aria-checked", "true");
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(page.getByRole("radio", { name: "Colour #3d7fc1" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await page.goto(`/p/${projectId}`);
    await expect(page.getByRole("button", { name: /Ada Lovelace/ })).toBeVisible();
  });

  test("a face can be an emoji, and Initials brings the initials back", async ({ page }) => {
    await register(page, "Ada Lovelace");
    const projectId = await createProject(page, unique("Face"));
    await addTask(page, "Todo", "Whose face");
    const panel = page.getByTestId("task-panel");
    await panel.getByRole("button", { name: "Assignee Unassigned", exact: true }).click();
    await saved(page, () =>
      panel.getByRole("option", { name: "Ada Lovelace", exact: true }).click(),
    );
    await page.getByRole("button", { name: "Close task" }).click();
    const onCard = card(page, "Whose face").locator('[title="Ada Lovelace"]');
    await expect(onCard).toHaveText("AL");

    await page.goto("/account");
    const faces = page.getByRole("radiogroup", { name: "Your face" });
    await expect(faces.getByRole("radio", { name: "Initials" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await pick(page, faces.getByRole("radio", { name: "Face 🦊" }));
    await expect(faces.getByRole("radio", { name: "Face 🦊" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // The board is read afresh, and the face follows the person everywhere.
    await page.goto(`/p/${projectId}`);
    await expect(onCard).toHaveText("🦊");
    await card(page, "Whose face").click();
    await expect(panel.locator('[title="Ada Lovelace"]').first()).toHaveText("🦊");
    await expect(panel.locator('[title="Ada Lovelace"]', { hasText: "AL" })).toHaveCount(0);

    await page.goto("/account");
    await pick(page, faces.getByRole("radio", { name: "Initials" }));
    await page.goto(`/p/${projectId}`);
    await expect(onCard).toHaveText("AL");
  });

  test("a quick pick back to the first face is still saved", async ({ page }) => {
    await register(page, "Quick Picker");
    await page.goto("/account");
    const faces = page.getByRole("radiogroup", { name: "Your face" });
    const sent: unknown[] = [];
    page.on("request", (req) => {
      if (req.url().endsWith("/api/auth/me") && req.method() === "PATCH") {
        sent.push(req.postDataJSON().emoji);
      }
    });
    const both = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/auth/me") &&
        res.request().method() === "PATCH" &&
        res.request().postDataJSON().emoji === null,
    );
    await faces.getByRole("radio", { name: "Face 🦊" }).click();
    await faces.getByRole("radio", { name: "Initials" }).click();
    expect((await both).status()).toBe(200);
    expect(sent).toEqual(["🦊", null]);

    await page.reload();
    await expect(faces.getByRole("radio", { name: "Initials" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a face set through the API and not on the grid still shows as picked", async ({ page }) => {
    await register(page, "Grace Hopper");
    const pair = "🧑🏿‍🤝‍🧑🏻";
    const res = await page.request.patch("/api/auth/me", { data: { emoji: pair } });
    expect(res.status()).toBe(200);
    expect((await page.request.patch("/api/auth/me", { data: { emoji: "GH" } })).status()).toBe(
      400,
    );

    await page.goto("/account");
    const faces = page.getByRole("radiogroup", { name: "Your face" });
    await expect(faces.getByRole("radio", { name: `Face ${pair}` })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(faces.locator('[aria-checked="true"]')).toHaveCount(1);
  });

  test("any one emoji typed in the box becomes the face, and other text saves nothing", async ({
    page,
  }) => {
    await register(page, "Typed Face");
    await page.goto("/account");
    const faces = page.getByRole("radiogroup", { name: "Your face" });
    const box = page.getByRole("textbox", { name: "Or type any emoji" });
    const sent: unknown[] = [];
    page.on("request", (req) => {
      if (req.url().endsWith("/api/auth/me") && req.method() === "PATCH") {
        sent.push(req.postDataJSON().emoji);
      }
    });

    for (const text of ["😀😀", "ab", "🏽"]) {
      await box.fill(text);
      await expect(page.getByText("One emoji only.")).toBeVisible();
    }
    await box.fill("");
    await expect(page.getByText("One emoji only.")).toHaveCount(0);
    expect(sent).toEqual([]);

    const face = "🧑‍🚀";
    const saved = page.waitForResponse(
      (res) => res.url().endsWith("/api/auth/me") && res.request().method() === "PATCH",
    );
    await box.fill(face);
    expect((await saved).status()).toBe(200);
    await expect(box).toHaveValue("");
    await expect(faces.getByRole("radio", { name: `Face ${face}` })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByText("One emoji only.")).toHaveCount(0);
    expect(sent).toEqual([face]);

    await page.reload();
    await expect(faces.getByRole("radio", { name: `Face ${face}` })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("the password needs the old one, and says so when it is wrong", async ({ page }) => {
    await register(page, "Careful Person");

    await page.goto("/account");
    await page.getByLabel("The password you use now").fill("not-the-password");
    await page.getByLabel("The password you want").fill("a-longer-secret");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("That is not the password you use now.")).toBeVisible();

    await page.getByLabel("The password you use now").fill("ushabti-secret");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("toast")).toContainText("Password changed");
  });

  test("each password box has the eye the sign-in page has", async ({ page }) => {
    await register(page, "Careful Person");
    await page.goto("/account");

    // No worded button any more: one reveal reads one way everywhere.
    await expect(page.getByRole("button", { name: /the passwords/ })).toHaveCount(0);

    for (const [field, what] of [
      ["The password you use now", "the current password"],
      ["The password you want", "the new password"],
    ]) {
      const box = page.getByLabel(field);
      await box.fill("a-long-secret");
      await expect(box).toHaveAttribute("type", "password");

      const show = page.getByRole("button", { name: `Show ${what}` });
      await expect(show).toHaveAttribute("aria-pressed", "false");
      await expect(show).toHaveText("");
      await expect(show.locator("svg")).toBeVisible();

      await show.click();
      await expect(box).toHaveAttribute("type", "text");
      await expect(box).toHaveValue("a-long-secret");

      const hide = page.getByRole("button", { name: `Hide ${what}` });
      await expect(hide).toHaveAttribute("aria-pressed", "true");
      await hide.click();
      await expect(box).toHaveAttribute("type", "password");
    }

    // Each eye answers for its own box.
    await page.getByRole("button", { name: "Show the new password" }).click();
    await expect(page.getByLabel("The password you want")).toHaveAttribute("type", "text");
    await expect(page.getByLabel("The password you use now")).toHaveAttribute("type", "password");
  });

  test("the account page is reachable from the user menu", async ({ page }) => {
    await register(page);
    await page.goto("/projects");
    await page.getByRole("button", { name: /Test Person/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await expect(page).toHaveURL(/\/account$/);
  });
});
