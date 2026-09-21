import { describe, expect, it } from "vitest";
import { SWIPE, swipeStep } from "../phone";

/*
 * The one rule a swipe has, kept pure so it can be asked without a finger.
 * A phone board pages sideways and scrolls up and down, and the two must
 * never be confused: a thumb reading a column would otherwise turn the page.
 */
describe("a swipe across a phone board", () => {
  it("brings in the next column when the finger goes left", () => {
    expect(swipeStep(-SWIPE, 0)).toBe(1);
    expect(swipeStep(-200, 10)).toBe(1);
  });

  it("goes back a column when the finger goes right", () => {
    expect(swipeStep(SWIPE, 0)).toBe(-1);
    expect(swipeStep(200, -10)).toBe(-1);
  });

  it("says nothing about a short finger", () => {
    expect(swipeStep(-59, 0)).toBe(0);
    expect(swipeStep(59, 0)).toBe(0);
    expect(swipeStep(0, 0)).toBe(0);
  });

  /* A column scrolls under a thumb that is not quite straight, and that
     thumb must not page the board. */
  it("leaves a scroll alone, however far it went", () => {
    expect(swipeStep(80, 300)).toBe(0);
    expect(swipeStep(-80, -300)).toBe(0);
    expect(swipeStep(100, 100)).toBe(0);
  });
});
