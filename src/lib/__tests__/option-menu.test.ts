import { describe, expect, it } from "vitest";
import { optionMenu } from "../option-menu";
import type { PropertyOptionDTO } from "../types";

function options(...names: string[]): PropertyOptionDTO[] {
  return names.map((name, i) => ({ id: `o${i}`, name, color: "#fff", position: `${i}` }));
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
