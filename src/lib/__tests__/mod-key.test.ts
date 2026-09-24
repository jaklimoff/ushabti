import { describe, expect, it } from "vitest";
import { modKeyFor } from "@/lib/mod-key";

describe("modKeyFor", () => {
  it("says ⌘ on a Mac, an iPad and an iPhone", () => {
    for (const platform of ["MacIntel", "MacPPC", "iPad", "iPhone"]) {
      expect(modKeyFor(platform)).toBe("⌘");
    }
  });

  it("says Ctrl on Windows, Linux and an unknown machine", () => {
    for (const platform of ["Win32", "Linux x86_64", "Linux armv8l", ""]) {
      expect(modKeyFor(platform)).toBe("Ctrl");
    }
  });
});
