import { describe, expect, it } from "vitest";
import {
  buildChangelog,
  changelogSlug,
  publicChangelog,
  shippedDay,
  type ChangelogInput,
} from "../changelog";

const project = { id: "p", name: "Ushabti", key: "USH" };

function input(over: Partial<ChangelogInput> = {}): ChangelogInput {
  return {
    project,
    properties: [
      {
        id: "version",
        name: "Version",
        type: "select",
        options: [
          { id: "v1", name: "0.1", shippedAt: "2026-09-01", note: "First **one**." },
          { id: "v2", name: "0.2", shippedAt: "2026-10-01", note: null },
          { id: "v3", name: "0.3", shippedAt: null, note: "Not yet." },
        ],
      },
    ],
    tasks: [
      { id: "b", number: 2, title: "Second", position: "b", values: { version: "v1" } },
      { id: "a", number: 1, title: "First", position: "a", values: { version: "v1" } },
      { id: "c", number: 3, title: "Third", position: "c", values: { version: "v2" } },
      { id: "d", number: 4, title: "Later", position: "d", values: { version: "v3" } },
    ],
    ...over,
  };
}

describe("the changelog", () => {
  it("lists the shipped options newest first, with the date and the note", () => {
    const log = buildChangelog(input());
    expect(log.entries.map((e) => [e.name, e.shippedAt, e.note])).toEqual([
      ["0.2", "2026-10-01", null],
      ["0.1", "2026-09-01", "First **one**."],
    ]);
  });

  it("lists the tasks of each option in board order, with their keys", () => {
    const log = buildChangelog(input());
    expect(log.entries[1].tasks).toEqual([
      { id: "a", key: "USH-1", title: "First" },
      { id: "b", key: "USH-2", title: "Second" },
    ]);
  });

  it("keeps the Settings order for two options shipped on one day", () => {
    const log = buildChangelog(
      input({
        properties: [
          {
            id: "sprint",
            name: "Sprint",
            type: "select",
            options: [
              { id: "s1", name: "One", shippedAt: "2026-10-01", note: null },
              { id: "s2", name: "Two", shippedAt: "2026-10-01", note: null },
            ],
          },
        ],
      }),
    );
    expect(log.entries.map((e) => e.name)).toEqual(["One", "Two"]);
  });

  it("reads only a select property", () => {
    const log = buildChangelog(
      input({
        properties: [
          {
            id: "tags",
            name: "Tags",
            type: "multi_select",
            options: [{ id: "t", name: "Tag", shippedAt: "2026-10-01", note: null }],
          },
        ],
      }),
    );
    expect(log.entries).toEqual([]);
  });

  it("treats a blank note as no note", () => {
    const log = buildChangelog(
      input({
        properties: [
          {
            id: "version",
            name: "Version",
            type: "select",
            options: [{ id: "v1", name: "0.1", shippedAt: "2026-09-01", note: "  \n" }],
          },
        ],
      }),
    );
    expect(log.entries[0].note).toBeNull();
  });
});

describe("the public changelog", () => {
  it("carries no key, no id and no person", () => {
    const shown = publicChangelog(buildChangelog(input()));
    expect(shown).toEqual({
      project: { name: "Ushabti" },
      entries: [
        { name: "0.2", shippedAt: "2026-10-01", note: null, tasks: [{ title: "Third" }] },
        {
          name: "0.1",
          shippedAt: "2026-09-01",
          note: "First **one**.",
          tasks: [{ title: "First" }, { title: "Second" }],
        },
      ],
    });
    expect(JSON.stringify(shown)).not.toMatch(/USH|"id"/);
  });

  it("is addressed by the key in lower case", () => {
    expect(changelogSlug("USH")).toBe("ush");
  });
});

describe("the shipped day", () => {
  it("reads in words with its year, the same in every zone", () => {
    expect(shippedDay("2026-10-01")).toBe("October 1, 2026");
  });

  it("leaves a day it cannot read as it is", () => {
    expect(shippedDay("soon")).toBe("soon");
  });
});
