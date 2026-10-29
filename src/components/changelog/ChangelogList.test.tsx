import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ChangelogList } from "./ChangelogList";
import { ReleasesOff } from "./ReleasesOff";

/*
 * **Older** is the one thing the list adds to a page of releases. Which ten
 * a page holds, and what `?shown=` reads, is `release-route.test.ts`.
 */

const entries = Array.from({ length: 10 }, (_, i) => ({
  name: `0.${20 - i}`,
  shippedAt: "2026-10-01",
  note: null,
  tasks: [{ title: `Task ${i}` }],
}));

describe("The changelog list", () => {
  test("asks for ten more at the same address while older releases are left", async () => {
    await render(<ChangelogList entries={entries} older={12} path="/changelog/ush" />);
    await expect
      .element(page.getByRole("link", { name: "Older" }))
      .toHaveAttribute("href", "/changelog/ush?shown=20");
  });

  test("draws no Older once the oldest release is on the page", async () => {
    await render(<ChangelogList entries={entries} older={0} path="/changelog/ush" />);
    await expect.element(page.getByText("Task 9")).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Older" })).not.toBeInTheDocument();
  });
});

describe("A changelog with releases off", () => {
  test("says what it is for, and hands an admin the way to turn releases on", async () => {
    await render(<ReleasesOff projectId="p1" role="admin" />);
    await expect.element(page.getByText("Releases are off")).toBeVisible();
    await expect
      .element(page.getByText(/A changelog lists each release that shipped/))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Turn on releases in Settings" }))
      .toHaveAttribute("href", "/p/p1/settings/properties");
  });

  test("tells a member who turns them on, and offers no link", async () => {
    await render(<ReleasesOff projectId="p1" role="member" />);
    await expect
      .element(page.getByText("An admin turns them on in Settings → Properties."))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Turn on releases in Settings" }))
      .not.toBeInTheDocument();
  });
});
