import { describe, expect, it } from "vitest";
/* A test may take the namespace; the app may not, because it would ship it. */
import * as lucide from "lucide-react";
import { OPTION_ICONS } from "@/lib/option-icons";
import { ICON_OF } from "./OptionIcon";

describe("OptionIcon", () => {
  it("draws every name in the catalogue", () => {
    const missing = OPTION_ICONS.filter((name) => !ICON_OF[name]);
    expect(missing).toEqual([]);
  });

  it("draws each name as the lucide icon of that name", () => {
    const wrong = OPTION_ICONS.filter(
      (name) => ICON_OF[name] !== (lucide as Record<string, unknown>)[name],
    );
    expect(wrong).toEqual([]);
  });

  it("holds no icon the catalogue does not name", () => {
    expect(Object.keys(ICON_OF).sort()).toEqual([...OPTION_ICONS].sort());
  });
});
