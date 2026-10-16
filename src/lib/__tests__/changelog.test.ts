import { describe, expect, it } from "vitest";
import {
  buildChangelog,
  CHANGELOG_PAGE,
  changelogSlug,
  newestShipped,
  publicChangelog,
  readShown,
  shippedDay,
  shippedSaid,
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

  it("lists no sprint, because a sprint closes and never ships", () => {
    const log = buildChangelog(
      input({
        properties: [
          {
            id: "sprint",
            name: "Sprint",
            type: "iteration",
            options: [{ id: "s1", name: "Sprint 1", shippedAt: "2026-10-01", note: null }],
          },
        ],
      }),
    );
    expect(log.entries).toEqual([]);
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

describe("the date of an entry", () => {
  it("says shipped", () => {
    const log = buildChangelog(input());
    expect(log.entries.map((e) => shippedSaid(e))).toEqual([
      "Shipped October 1, 2026",
      "Shipped September 1, 2026",
    ]);
  });
});

describe("the public changelog", () => {
  it("carries no key, no id and no person", () => {
    const shown = publicChangelog(buildChangelog(input()));
    expect(shown).toEqual({
      project: { name: "Ushabti" },
      entries: [
        {
          name: "0.2",
          shippedAt: "2026-10-01",
          note: null,
          tasks: [{ title: "Third" }],
        },
        {
          name: "0.1",
          shippedAt: "2026-09-01",
          note: "First **one**.",
          tasks: [{ title: "First" }, { title: "Second" }],
        },
      ],
      older: 0,
    });
    expect(JSON.stringify(shown)).not.toMatch(/USH|"id"/);
  });

  it("is addressed by the key in lower case", () => {
    expect(changelogSlug("USH")).toBe("ush");
  });
});

describe("a page of the changelog", () => {
  /* A hundred releases on one Version, shipped a day apart, plus a sprint
     that closed in between and must not take a place. */
  const many: ChangelogInput["properties"] = [
    {
      id: "version",
      name: "Version",
      type: "select",
      options: Array.from({ length: 100 }, (_, i) => ({
        id: `v${i}`,
        name: `0.${i}`,
        shippedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
        note: null,
      })),
    },
    {
      id: "sprint",
      name: "Sprint",
      type: "iteration",
      options: [{ id: "s", name: "S1", shippedAt: "2026-12-31", note: null }],
    },
  ];

  it("keeps the newest ten and counts the rest", () => {
    const { properties, older } = newestShipped(many, CHANGELOG_PAGE);
    expect(older).toBe(90);
    const log = buildChangelog({ project, properties, tasks: [] }, older);
    expect(log.entries.map((e) => e.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `0.${99 - i}`),
    );
    expect(log.older).toBe(90);
  });

  it("keeps everything when asked for more than there is", () => {
    const { older, properties } = newestShipped(many, Infinity);
    expect(older).toBe(0);
    expect(buildChangelog({ project, properties, tasks: [] }).entries).toHaveLength(100);
  });

  it("cuts two releases of one day in the Settings order", () => {
    const sameDay = input({
      properties: [
        {
          id: "version",
          name: "Version",
          type: "select",
          options: [
            { id: "a", name: "A", shippedAt: "2026-10-01", note: null },
            { id: "b", name: "B", shippedAt: "2026-10-01", note: null },
          ],
        },
      ],
    });
    const { properties, older } = newestShipped(sameDay.properties, 1);
    expect(properties[0].options.map((o) => o.name)).toEqual(["A"]);
    expect(older).toBe(1);
  });

  it("reads a whole number of pages from the address, and the first page from anything else", () => {
    expect(readShown("20")).toBe(20);
    expect(readShown("100")).toBe(100);
    for (const raw of [undefined, "", "0", "5", "15", "-10", "1e2", "ten", ["20"], "9999999"]) {
      expect(readShown(raw)).toBe(CHANGELOG_PAGE);
    }
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
