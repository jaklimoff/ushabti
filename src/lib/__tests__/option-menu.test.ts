import { describe, expect, it } from "vitest";
import { openingAt, optionMenu } from "../option-menu";
import type { PropertyOptionDTO } from "../types";

function options(...names: string[]): PropertyOptionDTO[] {
  return names.map((name, i) => ({
    id: `o${i}`,
    name,
    color: "#fff",
    position: `${i}`,
    startAt: null,
    targetAt: null,
    shippedAt: null,
    note: null,
  }));
}

const PRIORITY = options("Low", "Highest", "High", "Medium");

function names(draft: string) {
  const menu = optionMenu(PRIORITY, draft);
  return { matches: menu.matches.map((o) => o.name), add: menu.add };
}

describe("optionMenu", () => {
  it("offers every option, and no Add, before anything is typed", () => {
    expect(names("")).toEqual({ matches: ["Low", "Highest", "High", "Medium"], add: null });
    expect(names("   ")).toEqual({ matches: ["Low", "Highest", "High", "Medium"], add: null });
  });

  /* The fault this exists for: two matches used to make Enter create "hi". */
  it("offers Add after the matches when none is the name typed", () => {
    expect(names("hi")).toEqual({ matches: ["Highest", "High"], add: "hi" });
  });

  it("never offers Add for a name the menu does not list but the property has", () => {
    const shown = PRIORITY.slice(1);
    expect(optionMenu(shown, "low", PRIORITY)).toEqual({ matches: [], add: null });
  });

  it("never offers Add for a name that is there, in any case", () => {
    expect(names("high").add).toBeNull();
    expect(names(" HIGH ").add).toBeNull();
  });

  it("puts the exact name first, so Enter picks it", () => {
    expect(names("high").matches).toEqual(["High", "Highest"]);
  });

  it("offers only Add when nothing matches", () => {
    expect(names("  Blocker ")).toEqual({ matches: [], add: "Blocker" });
  });
});

describe("openingAt", () => {
  const SPRINTS = options("Sprint 1", "Sprint 2", "Sprint 3");

  it("opens on the current option, past the empty row, whatever the field holds", () => {
    expect(openingAt(SPRINTS, null, "o1")).toBe(2);
    expect(openingAt(SPRINTS, "o0", "o1")).toBe(2);
  });

  it("opens on the value with no current option, and on the empty row with neither", () => {
    expect(openingAt(SPRINTS, "o2", null)).toBe(3);
    expect(openingAt(SPRINTS, null, null)).toBe(0);
  });
});
