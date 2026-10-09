import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { linking } from "@/test/links";
import { BoardShell } from "./BoardApp";

/*
 * The lists of what a task waits on, on a phone. It was the phone test of
 * `e2e/blockers.spec.ts`, and has its name.
 *
 * This file runs in a page made with touch, which answers `(hover: none)` as
 * a phone does: the ✕ is drawn on a hover, and a finger has none.
 */

afterEach(async () => {
  await page.viewport(1440, 900);
});

describe("What a task waits on, on a phone", () => {
  test("the lists fit, and the ✕ is drawn where there is no hover", async () => {
    await page.viewport(390, 780);
    expect(matchMedia("(hover: none)").matches).toBe(true);
    const data = newProject();
    const ship = withTask(data, "Ship the thing with quite a long title on it", { Status: "Todo" });
    const wire = withTask(data, "Wire the queue up properly first", { Status: "Todo" });
    const fake = linking(data);
    fake.blockedBy(ship, wire);
    await renderWithBoard(<BoardShell initialTask={ship.id} />, data, fake.answer);

    await expect.element(page.getByTestId("link-row")).toBeVisible();
    const doc = document.documentElement;
    expect(Math.max(doc.scrollWidth - doc.clientWidth, 0)).toBe(0);

    /* The ✕ is the only way a link goes, and there is no hover down here to
       bring it out. So it is drawn, and it is big enough to press. */
    const unlink = page.getByRole("button", { name: /^Unlink / });
    await expect.element(unlink).toBeVisible();
    const el = unlink.element();
    expect(Number(getComputedStyle(el).opacity)).toBe(1);
    const at = el.getBoundingClientRect();
    expect(at.width).toBeGreaterThanOrEqual(24);
    expect(at.height).toBeGreaterThanOrEqual(24);
  });
});
