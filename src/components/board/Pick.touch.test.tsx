import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * The check in a list gutter under a finger. It was a 14 px square in a 28 px
 * gutter on a 32 px row, and a miss opened the task.
 *
 * This file runs in a page made with touch, which answers `(hover: none)` as
 * a phone does. Chromium cannot turn that back off in a page, so a test that
 * switched it on in the shared pages left every later file in that page with
 * no hover, and the listening tip stayed open after a click.
 */

afterEach(async () => {
  await page.viewport(1440, 900);
});

describe("Picking on a list under a finger", () => {
  test("gives the check a finger's room, and draws the same check", async () => {
    await page.viewport(390, 780);
    expect(matchMedia("(hover: none)").matches).toBe(true);
    const data = newProject();
    withTask(data, "Aardvark", { Status: "Todo" });
    for (const view of data.views) view.isDefault = false;
    data.views.push({
      ...data.views[0],
      id: "00000000-0000-4000-8000-777777777777",
      name: "Everything",
      kind: "list",
      position: "z0000000",
      isDefault: true,
    });
    await renderWithBoard(<BoardShell initialTask={null} />, data, serving(data).answer);

    const row = page.getByTestId("list-row").filter({ hasText: "Aardvark" });
    const check = row.getByTestId("list-pick");
    await expect.element(check).toBeInTheDocument();
    /* It stands there without a hover, because a finger has none. */
    expect(getComputedStyle(check.element()).opacity).toBe("1");
    const at = check.element().getBoundingClientRect();
    expect(at.width).toBeGreaterThanOrEqual(24);
    expect(at.height).toBeGreaterThanOrEqual(24);

    /* The button grew around the box, so the check reads as it always did. */
    const box = check.getByTestId("list-pick-box").element().getBoundingClientRect();
    expect(Math.round(box.width)).toBe(14);
    expect(Math.round(box.height)).toBe(14);
  });
});
