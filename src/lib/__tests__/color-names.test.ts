import { describe, expect, it } from "vitest";
import { PALETTE, PROJECT_COLORS, colorName } from "@/lib/colors";

describe("colorName", () => {
  it("names every colour a swatch offers, and no two alike", () => {
    const all = [...PALETTE, ...PROJECT_COLORS];
    const names = all.map(colorName);
    for (const [i, name] of names.entries()) expect(name).not.toBe(all[i]);
    expect(new Set(names).size).toBe(all.length);
  });

  it("reads a colour from outside the palette as its code", () => {
    expect(colorName("#123456")).toBe("#123456");
    expect(colorName("#E0574D")).toBe("Red");
  });
});
