import { describe, expect, it } from "vitest";
import { activityWords, describeActivity } from "./TaskPanel";
import { putBackQuestion } from "./DescriptionChanges";

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

/* USH-468: a title or a value line says what it was before. */
const said = (
  kind: string,
  data: Record<string, unknown>,
  nameOf = (_: unknown) => null as string | null,
) => describeActivity({ kind, data, actor: { id: "a1", name: "Jack" } }, "Demo", nameOf);

describe("A title line in the activity log", () => {
  it("says the old title and the new one", () => {
    expect(said("title", { title: "Retries stop after five tries", from: "queue thing" })).toBe(
      "Jack renamed it from “queue thing” to “Retries stop after five tries”",
    );
  });

  it("reads as it did without a from", () => {
    expect(said("title", { title: "Ship it" })).toBe("Jack renamed it to “Ship it”");
  });
});

describe("A value line in the activity log", () => {
  it("says the old value and the new one", () => {
    expect(
      said("value", { property: "Status", type: "select", value: "In Progress", from: "Todo" }),
    ).toBe("Jack set Status from Todo to In Progress");
  });

  it("says empty for a side with nothing", () => {
    expect(said("value", { property: "Estimate", type: "select", value: "S", from: "empty" })).toBe(
      "Jack set Estimate from empty to S",
    );
    expect(said("value", { property: "Due", type: "date", value: "empty", from: "14 Nov" })).toBe(
      "Jack set Due from 14 Nov to empty",
    );
  });

  it("names both people as they are named now", () => {
    const names: Record<string, string> = { u1: "Reis", u2: "Ada" };
    expect(
      said(
        "value",
        {
          property: "Assignee",
          type: "person",
          value: "Ada Old",
          personId: "u2",
          from: "u1",
          fromPersonId: "u1",
        },
        (id) => names[id as string] ?? null,
      ),
    ).toBe("Jack set Assignee from Reis to Ada");
  });

  it("says what a multi-select gained and lost", () => {
    const labels = (added: string[], removed: string[]) =>
      said("value", {
        property: "Labels",
        type: "multi_select",
        value: "x",
        from: "y",
        added,
        removed,
      });
    expect(labels(["bug"], ["ux"])).toBe("Jack added bug to Labels and took ux away");
    expect(labels(["bug"], [])).toBe("Jack added bug to Labels");
    expect(labels([], ["ux"])).toBe("Jack took ux away from Labels");
  });

  it("reads as it did without a from", () => {
    expect(said("value", { property: "Status", type: "select", value: "Done" })).toBe(
      "Jack set Status to Done",
    );
  });

  it("marks the new value brighter than the old one", () => {
    const pieces = activityWords(
      { kind: "value", data: { property: "Status", value: "Doing", from: "Todo" }, actor: null },
      "Demo",
      () => null,
    );
    expect(pieces.filter((p) => p.tone)).toEqual([
      { text: "Todo", tone: "was" },
      { text: "Doing", tone: "now" },
    ]);
  });
});

/* USH-471: a put-back names whose edit it undid. */
describe("A put-back line in the activity log", () => {
  const reis = (id: unknown) => (id === "u2" ? "Reis" : null);

  it("names the person whose edit was put back", () => {
    expect(
      said("description", { versionId: "v", restoredFrom: "v1", restoredActorId: "u2" }, reis),
    ).toBe("Jack put the description back as it was before Reis’s edit");
  });

  it("says their own edit when it was the actor's", () => {
    expect(said("description", { versionId: "v", restoredFrom: "v1", restoredActorId: "a1" })).toBe(
      "Jack put the description back as it was before their own edit",
    );
  });

  it("says an earlier edit when the other actor is gone", () => {
    expect(said("description", { versionId: "v", restoredFrom: "v1", restoredActorId: null })).toBe(
      "Jack put the description back as it was before an earlier edit",
    );
  });

  it("reads a plain edit as it did", () => {
    expect(said("description", { versionId: "v" })).toBe("Jack edited the description");
  });
});

describe("The put-back question", () => {
  const reis = { id: "u2", name: "Reis" };
  const tail = "What is there now stays in the history.";

  it("counts what goes and what comes back on the newest edit", () => {
    expect(putBackQuestion({ gone: 2, added: 5 }, true, reis, "u1")).toBe(
      `Put the description back as it was before this edit? The 5 lines Reis added go, and the 2 lines come back. ${tail}`,
    );
  });

  it("says everything written since goes when later edits exist", () => {
    expect(putBackQuestion({ gone: 2, added: 5 }, false, reis, "u1")).toBe(
      `Put the description back as it was before this edit? Everything written since goes too. ${tail}`,
    );
  });

  it("speaks to the person about their own edit", () => {
    expect(putBackQuestion({ gone: 0, added: 1 }, true, reis, "u2")).toBe(
      `Put the description back as it was before this edit? The 1 line you added goes. ${tail}`,
    );
  });
});
