import { describe, expect, it } from "vitest";
import { findIcons, OPTION_ICONS } from "@/lib/option-icons";

describe("findIcons", () => {
  it("finds every icon for an empty box", () => {
    expect(findIcons("")).toEqual([...OPTION_ICONS]);
    expect(findIcons("   ")).toEqual([...OPTION_ICONS]);
  });

  it("finds by name and by a word, whatever the case", () => {
    expect(findIcons("BUG")).toEqual(["Bug"]);
    expect(findIcons("magnify")).toEqual(["Search"]);
    // A name of two words is found by its second.
    expect(findIcons("open")).toContain("BookOpen");
  });

  it("needs every word typed, and keeps the list's order", () => {
    const check = findIcons("check");
    expect(check.length).toBeGreaterThan(1);
    expect(check).toEqual(OPTION_ICONS.filter((name) => check.includes(name)));
    expect(findIcons("check done")).toEqual(["CheckCircle"]);
  });

  it("finds nothing for a word no icon has", () => {
    expect(findIcons("zebra")).toEqual([]);
  });
});
