import { describe, expect, it } from "vitest";
import { canStartAs, defaultsFor, readDefaults, readWhens, startsWith } from "../when";
import { seedNote } from "../filters";
import type { PropertyConfig, PropertyDTO, PropertyOptionDTO } from "../types";

function option(id: string, name: string): PropertyOptionDTO {
  return {
    id,
    name,
    color: "#9aa0aa",
    position: "V",
    startAt: null,
    targetAt: null,
    shippedAt: null,
    note: null,
  };
}

function property(id: string, name: string, extra: Partial<PropertyDTO> = {}): PropertyDTO {
  return { id, name, type: "text", position: "V", config: {}, options: [], ...extra };
}

const type = property("p-type", "Type", {
  type: "select",
  options: [option("o-bug", "Bug"), option("o-story", "Story")],
});
const onBug = { propertyId: "p-type", optionIds: ["o-bug"] };
const severity = property("p-sev", "Severity", {
  type: "select",
  options: [option("o-minor", "Minor"), option("o-major", "Major")],
  config: { when: onBug, defaults: { "o-bug": "o-minor" } },
});
const labels = property("p-labels", "Labels", {
  type: "multi_select",
  options: [option("o-ui", "ui"), option("o-api", "api")],
  config: { defaults: { "o-bug": ["o-ui", "o-gone"] } },
});
const flaky = property("p-flaky", "Flaky", {
  type: "checkbox",
  config: { defaults: { "o-bug": true } },
});
const points = property("p-points", "Points", {
  type: "number",
  config: { defaults: { "o-story": 3, "o-bug": "three" } },
});
const notes = property("p-notes", "Notes", {
  config: { defaults: { "o-story": "As a …" } },
});
const owner = property("p-owner", "Owner", {
  type: "person",
  config: { defaults: { "o-bug": "u-ada" } },
});
const due = property("p-due", "Due", {
  type: "date",
  config: { defaults: { "o-bug": "2026-10-06" } },
});

const all = [type, severity, labels, flaky, points, notes, owner, due];
const defaultsOf = (read: PropertyDTO[], id: string) =>
  read.find((p) => p.id === id)!.config.defaults;

describe("which properties can start as something", () => {
  it("is a select, a multi-select, a checkbox, a number and text", () => {
    for (const t of ["select", "multi_select", "checkbox", "number", "text"]) {
      expect(canStartAs(t)).toBe(true);
    }
    for (const t of ["person", "date", "link", "iteration"]) expect(canStartAs(t)).toBe(false);
  });
});

describe("the defaults a property carries, read", () => {
  const read = readDefaults(readWhens(all), "p-type");

  it("keeps a value that reads, under a live type", () => {
    expect(defaultsOf(read, "p-sev")).toEqual({ "o-bug": "o-minor" });
    expect(defaultsOf(read, "p-flaky")).toEqual({ "o-bug": true });
    expect(defaultsOf(read, "p-notes")).toEqual({ "o-story": "As a …" });
  });

  it("drops a deleted option from a multi-select, and a value of the wrong shape", () => {
    expect(defaultsOf(read, "p-labels")).toEqual({ "o-bug": ["o-ui"] });
    expect(defaultsOf(read, "p-points")).toEqual({ "o-story": 3 });
  });

  it("never reads one on a person, a date, a link or an iteration", () => {
    expect(defaultsOf(read, "p-owner")).toBeUndefined();
    expect(defaultsOf(read, "p-due")).toBeUndefined();
  });

  it("reads a deleted value option as none, with no error", () => {
    const gone = { ...severity, options: [option("o-major", "Major")] };
    const after = readDefaults(readWhens([type, gone]), "p-type");
    expect(defaultsOf(after, "p-sev")).toBeUndefined();
  });

  it("reads a deleted type option as none, with no error", () => {
    const noBug = { ...type, options: [option("o-story", "Story")] };
    const after = readDefaults(readWhens([noBug, severity]), "p-type");
    expect(defaultsOf(after, "p-sev")).toBeUndefined();
  });

  it("reads every default as none when the project names no Type", () => {
    for (const typeBy of [null, "p-gone", "p-notes"]) {
      const after = readDefaults(readWhens(all), typeBy);
      expect(after.every((p) => p.config.defaults === undefined)).toBe(true);
    }
  });

  it("reads junk as none", () => {
    for (const junk of [null, 7, "x", ["o-minor"]]) {
      const odd = { ...severity, config: { defaults: junk } as unknown as PropertyConfig };
      expect(defaultsOf(readDefaults([type, odd], "p-type"), "p-sev")).toBeUndefined();
    }
  });
});

describe("what a new task of one type starts with", () => {
  const read = readDefaults(readWhens(all), "p-type");

  it("gives the defaults of that type, for the properties that show on it", () => {
    expect(defaultsFor("o-bug", read, { "p-type": "o-bug" })).toEqual({
      "p-sev": "o-minor",
      "p-labels": ["o-ui"],
      "p-flaky": true,
    });
    expect(defaultsFor("o-story", read, { "p-type": "o-story" })).toEqual({
      "p-points": 3,
      "p-notes": "As a …",
    });
  });

  it("leaves a property that already has a value, even an empty one", () => {
    const sent = { "p-type": "o-bug", "p-sev": "o-major", "p-flaky": null };
    expect(defaultsFor("o-bug", read, sent)).toEqual({ "p-labels": ["o-ui"] });
  });

  it("never gives a default its property's own rule hides", () => {
    const onStory = {
      ...severity,
      config: { ...severity.config, defaults: { "o-story": "o-minor" } },
    };
    const props = readDefaults(readWhens([type, onStory]), "p-type");
    expect(defaultsFor("o-story", props, { "p-type": "o-story" })).toEqual({});
  });

  it("gives a default that another default shows, and none that another hides", () => {
    const area = property("p-area", "Area", {
      type: "select",
      options: [option("o-front", "Front"), option("o-back", "Back")],
      config: { defaults: { "o-bug": "o-front" } },
    });
    const shot = property("p-shot", "Screenshot", {
      type: "checkbox",
      config: {
        when: { propertyId: "p-area", optionIds: ["o-front"] },
        defaults: { "o-bug": true },
      },
    });
    const logs = property("p-logs", "Logs", {
      type: "checkbox",
      config: {
        when: { propertyId: "p-area", optionIds: ["o-back"] },
        defaults: { "o-bug": true },
      },
    });
    const props = readDefaults(readWhens([type, shot, logs, area]), "p-type");
    expect(defaultsFor("o-bug", props, { "p-type": "o-bug" })).toEqual({
      "p-area": "o-front",
      "p-shot": true,
    });
  });

  it("reads the type from the values, and gives nothing with none", () => {
    expect(startsWith("p-type", { "p-type": "o-bug" }, read)).toEqual(
      defaultsFor("o-bug", read, { "p-type": "o-bug" }),
    );
    expect(startsWith("p-type", {}, read)).toEqual({});
    expect(startsWith(null, { "p-type": "o-bug" }, read)).toEqual({});
  });
});

describe("what the composer says", () => {
  const read = readDefaults(readWhens(all), "p-type");

  it("says what a new task starts with, after what the filter sets", () => {
    const starts = startsWith("p-type", { "p-type": "o-bug" }, read);
    expect(seedNote({}, read, [], starts)).toBe("starts with Severity Minor, Labels ui, Flaky");
    expect(seedNote({ "p-type": "o-bug" }, read, [], { "p-points": 3 })).toBe(
      "sets Type Bug; starts with Points 3",
    );
    expect(seedNote({}, read, [], {})).toBe("");
  });
});
