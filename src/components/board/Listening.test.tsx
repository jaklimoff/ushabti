import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { minutesAgo, newProject, renderWithBoard, withAgent } from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * The faces in the top bar of the agents that hold the stream open. The
 * stream that writes `listeningAt` is end to end; here an agent comes with a
 * fresh one, and the test reads what the bar draws for it.
 */

/** The rule in the style sheet that shows `tip` when `face` has the focus on a screen with no hover. */
function tapRule(face: Element, tip: Element): CSSStyleRule | null {
  const selector = `.${face.classList[0]}:focus .${tip.classList[0]}`;
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSMediaRule) || rule.conditionText !== "(hover: none)") continue;
      for (const inner of rule.cssRules) {
        if (inner instanceof CSSStyleRule && inner.selectorText === selector) return inner;
      }
    }
  }
  return null;
}

describe("A listening agent", () => {
  /* Was e2e/listening.spec.ts "a listening agent says its name on hover and on
     focus". The tap on a phone is not done here: this page has hover, and only
     a `.touch.test.tsx` file is drawn in one without. So the test reads the
     rule a tap relies on instead. */
  test("a listening agent says its name on hover and on focus", async () => {
    const data = newProject();
    withAgent(data, "Refiner", minutesAgo(0));
    await renderWithBoard(<BoardShell initialTask={null} />, data);

    try {
      // A screen reader hears the name, and the face draws no native title.
      const agent = page.getByRole("img", { name: "Refiner is listening" });
      await expect.element(agent).toBeVisible();
      expect(agent.element().querySelectorAll("[title]")).toHaveLength(0);

      const tip = agent.getByTestId("listening-tip");
      await expect.element(tip).not.toBeVisible();
      await agent.hover();
      await expect.element(tip, { timeout: 200 }).toBeVisible();
      await expect.element(tip).toMatchTextContent("Refiner");
      await expect.element(tip).toMatchTextContent("Listening. It hears a new task at once.");

      await userEvent.unhover(agent);
      await expect.element(tip).not.toBeVisible();
      // A click gives focus too, and the tip must still go with the pointer.
      await agent.click();
      await expect.element(tip).toBeVisible();
      await userEvent.unhover(agent);
      await expect.element(tip).not.toBeVisible();
      page.getByTestId("search-box").element().focus();
      await userEvent.keyboard("{Tab}");
      await expect.element(agent).toHaveFocus();
      await expect.element(tip).toBeVisible();
      page.getByTestId("search-box").element().focus();

      // The tip stays in the window at either end of the bar: near the right
      // on a wide screen, near the left on a phone.
      for (const width of [1280, 375]) {
        await page.viewport(width, 700);
        await agent.hover();
        await expect.element(tip).toBeVisible();
        const box = tip.element().getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
        await userEvent.unhover(agent);
      }

      // A phone has no hover, so a tap is how it asks: there, any focus
      // shows the tip.
      const rule = tapRule(agent.element(), tip.element());
      expect(rule?.style.visibility).toBe("visible");
    } finally {
      await page.viewport(1440, 900);
    }
  });
});
