import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ChangelogList } from "./ChangelogList";

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
