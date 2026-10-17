import { expect, test } from "@playwright/test";
import { card, confirmDelete, createProject, register, unique } from "./helpers";

/*
 * One walk: the account page makes a token, a script acts with it, the board
 * says "via", and the ✕ ends it. What every route refuses is
 * `personal-tokens-route.test.ts`.
 */
test.describe("Personal tokens", () => {
  test("a token made on the account page acts as you, says so, and stops when revoked", async ({
    page,
    request,
  }, testInfo) => {
    await register(page, "Script Owner");
    const projectId = await createProject(page, unique("Tokens"));

    await page.goto("/account");
    await page.getByLabel("Token name").fill("Laptop script");
    await page.getByRole("button", { name: "Make token" }).click();
    const secret = await page.getByTestId("personal-secret").locator("code").innerText();
    expect(secret).toMatch(/^ushp_/);
    const row = page.getByTestId("personal-token-row").filter({ hasText: "Laptop script" });
    await expect(row).toContainText(secret.slice(0, 13));
    await expect(row).toContainText(/made \d+ \w+ \d{4}/);
    await expect(row).toContainText(/expires \d+ \w+ \d{4}/);
    await expect(row).toContainText("never used");

    const as = { Authorization: `Bearer ${secret}` };
    const made = await request.post(`/api/projects/${projectId}/tasks`, {
      headers: as,
      data: { title: "Filed by a script" },
    });
    expect(made.ok()).toBe(true);
    const { task } = (await made.json()) as { task: { id: string } };
    expect(
      (
        await request.post(`/api/tasks/${task.id}/comments`, {
          headers: as,
          data: { body: "Written from the laptop" },
        })
      ).status(),
    ).toBe(201);

    // Shown once: the page read again lists the token and not the secret.
    await page.reload();
    await expect(page.getByTestId("personal-secret")).toHaveCount(0);
    await expect(row).toContainText(/last used \d+ \w+ \d{4}/);
    await page.screenshot({
      path: testInfo.outputPath("seen-personal-tokens.png"),
      fullPage: true,
    });

    await row.getByRole("button", { name: "Revoke the token Laptop script" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Laptop script");
    await confirmDelete(page);
    await expect(row).toHaveCount(0);
    const after = await request.get("/api/auth/me", { headers: as });
    expect(after.status()).toBe(401);

    // What it wrote stays signed, also after the revoke.
    await page.goto(`/p/${projectId}`);
    await card(page, "Filed by a script").click();
    const comment = page.getByTestId("comment").filter({ hasText: "Written from the laptop" });
    await expect(comment).toContainText("via Laptop script");
    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect(page.getByText("via Laptop script").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-personal-token-via.png") });
  });
});
