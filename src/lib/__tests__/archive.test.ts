import { describe, expect, it } from "vitest";
import { archiveOrder, narrowArchive } from "../archive";
import type { ArchivedTaskDTO } from "../types";

function row(over: Partial<ArchivedTaskDTO> & { number: number }): ArchivedTaskDTO {
  return {
    id: `t-${over.number}`,
    key: `DP-${over.number}`,
    title: "",
    description: "",
    position: String(over.number).padStart(3, "0"),
    archivedAt: "2026-02-01T00:00:00.000Z",
    ...over,
  };
}

const ROWS: ArchivedTaskDTO[] = [
  row({ number: 1, title: "Log in with a passkey", archivedAt: "2026-02-01T09:00:00.000Z" }),
  row({ number: 4, title: "Rate limit the sign-in route", archivedAt: "2026-02-03T09:00:00.000Z" }),
  row({ number: 14, title: "Write the login guide", archivedAt: "2026-02-02T09:00:00.000Z" }),
];

const keys = (rows: ArchivedTaskDTO[]) => rows.map((t) => t.key);

describe("archiveOrder", () => {
  it("puts the newest archived first", () => {
    expect(keys(archiveOrder(ROWS))).toEqual(["DP-4", "DP-14", "DP-1"]);
  });

  it("leaves the rows it was given alone", () => {
    const before = keys(ROWS);
    archiveOrder(ROWS);
    expect(keys(ROWS)).toEqual(before);
  });

  /* A whole column goes in one statement, so every task in it carries the same
     moment. Without the rank the page would shuffle between two reads. */
  it("falls back to the rank when a sweep archived them together", () => {
    const at = "2026-03-01T12:00:00.000Z";
    const swept = [
      row({ number: 9, position: "c", archivedAt: at }),
      row({ number: 7, position: "a", archivedAt: at }),
      row({ number: 8, position: "b", archivedAt: at }),
    ];
    expect(keys(archiveOrder(swept))).toEqual(["DP-7", "DP-8", "DP-9"]);
  });
});

describe("narrowArchive", () => {
  it("answers everything for no words", () => {
    expect(keys(narrowArchive(ROWS, "   "))).toEqual(keys(ROWS));
  });

  it("finds a task by its key, whatever the case", () => {
    expect(keys(narrowArchive(ROWS, "dp-14"))).toEqual(["DP-14"]);
  });

  it("finds a task by words in its title", () => {
    expect(keys(narrowArchive(ROWS, "sign-in route"))).toEqual(["DP-4"]);
  });

  /* Every word has to be somewhere. A second word narrows, never widens. */
  it("narrows with every word given", () => {
    expect(keys(narrowArchive(ROWS, "login"))).toEqual(["DP-14"]);
    expect(keys(narrowArchive(ROWS, "login passkey"))).toEqual([]);
  });

  /* The row draws the key and the title. A hit on a word nobody can see on
     the page would read as a fault. */
  it("does not read the description", () => {
    const rows = [row({ number: 2, title: "Ship it", description: "It needs a passkey." })];
    expect(keys(narrowArchive(rows, "passkey"))).toEqual([]);
  });

  it("keeps the order it was given", () => {
    const ordered = archiveOrder(ROWS);
    expect(keys(narrowArchive(ordered, "the"))).toEqual(["DP-4", "DP-14"]);
  });
});
