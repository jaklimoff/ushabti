import { describe, expect, it } from "vitest";
import { sameOptionName, takenBy, takenSaid } from "../option-name";

describe("sameOptionName", () => {
  it("ignores letter case and the spaces around a name", () => {
    expect(sameOptionName("Blocked", "blocked")).toBe(true);
    expect(sameOptionName("Blocked", "  BLOCKED ")).toBe(true);
  });

  it("keeps a longer name apart", () => {
    expect(sameOptionName("High", "Highest")).toBe(false);
    expect(sameOptionName("In review", "Inreview")).toBe(false);
  });
});

describe("takenBy", () => {
  const siblings = [
    { id: "a", name: "Low" },
    { id: "b", name: "High" },
  ];

  it("finds the option that already carries the name", () => {
    expect(takenBy(siblings, "high")?.id).toBe("b");
  });

  it("lets a free name through", () => {
    expect(takenBy(siblings, "Highest")).toBeNull();
    expect(takenBy([], "High")).toBeNull();
  });
});

describe("takenSaid", () => {
  it("names the property and the option as it is spelt", () => {
    expect(takenSaid("Priority", "High")).toBe("Priority already has an option named High.");
  });
});
