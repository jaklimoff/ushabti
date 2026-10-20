import { expect, test } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

/*
 * Settings is opened from a view, and the way back names that view and lands
 * on it. The view rides in the address as `from`, so the rail carries it from
 * page to page and nothing about it is stored.
 */

test.describe("Back from Settings", () => {
  test("names the view it came from, and keeps it across settings pages", async ({
    page,
  }, testInfo) => {
    await register(page, "Returner");
    const projectId = await createProject(page, unique("Compass"));
    const made = await page.request.post(`/api/projects/${projectId}/views`, {
      data: { name: "Night shift", kind: "list" },
    });
    expect(made.status()).toBe(201);
    const phases = ((await made.json()) as { view: { id: string } }).view.id;

    await page.goto(`/p/${projectId}?view=${phases}`);
    await page.getByTestId("top-bar").getByRole("link", { name: "Settings", exact: true }).click();
    await page.waitForURL(`**/p/${projectId}/settings/properties?from=${phases}`);
    const back = page.getByRole("link", { name: "Back to Night shift" });
    await expect(back).toHaveAttribute("href", `/p/${projectId}?view=${phases}`);
    await page.screenshot({ path: testInfo.outputPath("seen-back-to-view.png") });

    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: "People" })
      .click();
    await page.waitForURL(`**/p/${projectId}/settings/people?from=${phases}`);
    await expect(back).toHaveAttribute("href", `/p/${projectId}?view=${phases}`);

    await back.click();
    await page.waitForURL(`**/p/${projectId}?view=${phases}`);
    await expect(page.getByTestId("view-pill").filter({ hasText: "Night shift" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("reads Back to board with no view, or a view that is gone", async ({ page }) => {
    await register(page, "Wanderer");
    const projectId = await createProject(page, unique("Drift"));
    for (const path of [
      `/p/${projectId}/settings/properties`,
      `/p/${projectId}/settings/people?from=00000000-0000-0000-0000-000000000000`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole("link", { name: "Back to board" }), path).toHaveAttribute(
        "href",
        `/p/${projectId}`,
      );
      /* The rail carries nothing it could not name. */
      await expect(
        page
          .getByRole("navigation", { name: "Settings sections" })
          .getByRole("link", { name: "Properties" }),
      ).toHaveAttribute("href", `/p/${projectId}/settings/properties`);
    }
  });
});
