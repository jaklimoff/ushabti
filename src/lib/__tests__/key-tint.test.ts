import { describe, expect, it } from "vitest";
import { PROJECT_COLORS, keyTint } from "@/lib/colors";

/*
 * A task key on Home, hovered: the project's colour tints its ground and its
 * letters. The letters have to stay readable on that ground for every colour
 * a project may wear.
 */

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function wcag(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("keyTint", () => {
  it.each(PROJECT_COLORS)("keeps WCAG AA on %s", (color) => {
    const tint = keyTint(color);
    expect(wcag(tint.color, tint.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("is the colour at 18% over the hovered row, and the colour a quarter toward white", () => {
    expect(keyTint("#7aa8f0")).toEqual({ background: "#2c3749", color: "#9bbef4" });
  });
});
