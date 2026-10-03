import { describe, expect, it } from "vitest";
import { KIND_OF_TYPE } from "../card-view";
import {
  GROUPABLE_TYPES,
  hasOptions,
  isSelect,
  PROPERTY_TYPE_LABEL,
  PROPERTY_TYPES,
} from "../types";

describe("the iteration type", () => {
  it("is a property type with the word Iteration", () => {
    expect(PROPERTY_TYPES).toContain("iteration");
    expect(PROPERTY_TYPE_LABEL.iteration).toBe("Iteration");
  });

  it("reads as a select on a card, and can group a board", () => {
    expect(KIND_OF_TYPE.iteration).toBe("select");
    expect(GROUPABLE_TYPES).toContain("iteration");
  });

  it("answers as a select to every question about one", () => {
    expect(isSelect("iteration")).toBe(true);
    expect(isSelect("select")).toBe(true);
    expect(isSelect("multi_select")).toBe(false);
    expect(hasOptions("iteration")).toBe(true);
    expect(hasOptions("multi_select")).toBe(true);
    expect(hasOptions("person")).toBe(false);
  });
});
