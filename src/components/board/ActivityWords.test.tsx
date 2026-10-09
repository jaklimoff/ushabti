import { describe, expect, it } from "vitest";
import { describeActivity } from "./TaskPanel";

/** The panel's activity log, in the words a person reads. */
const line = (data: Record<string, unknown>, name = "Scribe") =>
  describeActivity({ kind: "checklist", data, actor: { id: "a1", name } }, "Demo", () => null);

describe("A checklist line in the activity log", () => {
  it("names the item that was removed", () => {
    expect(line({ action: "removed", text: "Retries work" })).toBe(
      "Scribe removed the checklist item “Retries work”",
    );
  });

  it("names the old and the new words of a reword", () => {
    expect(
      line({ action: "renamed", from: "Retries work", text: "A failed send retries five times" }),
    ).toBe("Scribe reworded “Retries work” to “A failed send retries five times”");
  });

  it("reads a tick as it did", () => {
    expect(line({ action: "checked", text: "Ship it" }, "Ada")).toBe("Ada checked “Ship it”");
  });
});
