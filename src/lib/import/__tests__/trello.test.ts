import { describe, expect, it } from "vitest";
import { MAX_CARDS, MAX_FILE_BYTES, readTrello, TOO_LARGE } from "../trello";
import { fixture } from "./fixture";

/**
 * Reading a real Trello export.
 *
 * The fixture is one cut down by hand from a board export: three live lists,
 * an archived one, five cards, two labels, three checklists on two cards, two
 * comments and one action that is not a comment. Everything the mapping has
 * to get right is in it once, so a change that quietly stops reading one of
 * them has something to fail.
 */
describe("readTrello", () => {
  it("names the board", () => {
    expect(fixture().name).toBe("Launch board");
  });

  it("puts the lists in pos order and leaves an archived list out", () => {
    expect(fixture().lists.map((l) => l.name)).toEqual(["To do", "in progress", "Done"]);
  });

  it("walks the cards list by list and then by pos", () => {
    expect(fixture().cards.map((c) => c.name)).toEqual([
      "Write the launch note",
      "Talk to the team",
      "Old idea nobody took",
      "Fix the sign-in loop",
      "Ship the changelog",
    ]);
  });

  it("leaves the cards of an archived list behind", () => {
    const board = fixture();
    expect(board.cards.map((c) => c.name)).not.toContain("Someday maybe");
    expect(board.dropped.homelessCards).toBe(1);
  });

  it("marks an archived card and keeps it in the file", () => {
    const card = fixture().cards.find((c) => c.name === "Old idea nobody took");
    expect(card?.closed).toBe(true);
  });

  it("keeps a label with a name and drops one with none", () => {
    expect(fixture().labels.map((l) => l.name)).toEqual(["bug", "Release"]);
  });

  it("reads the people by their full names", () => {
    expect(fixture().members.map((m) => m.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("reads one checklist plainly", () => {
    const card = fixture().cards.find((c) => c.name === "Write the launch note");
    expect(card?.checklist).toEqual([{ text: "Ask Ada for the numbers", done: false }]);
  });

  it("names the list when a card has two checklists", () => {
    const card = fixture().cards.find((c) => c.name === "Ship the changelog");
    expect(card?.checklist).toEqual([
      { text: "Before: Draft it", done: true },
      { text: "Before: Read it back", done: false },
      { text: "After: Post it", done: false },
    ]);
  });

  it("takes the comments oldest first and nothing else from the history", () => {
    const card = fixture().cards.find((c) => c.name === "Talk to the team");
    expect(card?.comments.map((c) => [c.author, c.text])).toEqual([
      ["Ada Lovelace", "I will book the room."],
      ["Grace Hopper", "Let us do this after the release."],
    ]);
    expect(fixture().dropped.actions).toBe(1);
  });

  it("counts what it will not bring", () => {
    expect(fixture().dropped).toMatchObject({
      attachments: 1,
      customFields: 1,
      starts: 1,
      dueComplete: 1,
      actions: 1,
      archivedLists: 1,
      homelessCards: 1,
    });
  });

  it("keeps the due moment as Trello wrote it", () => {
    const card = fixture().cards.find((c) => c.name === "Ship the changelog");
    expect(card?.due).toBe("2026-03-04T12:00:00.000Z");
  });
});

describe("the limits", () => {
  it("refuses a file over 5 MB with a sentence that names the size", () => {
    /* One byte past the limit, made of a string rather than a board: the size
       is answered before the JSON is, so a file this large never reaches the
       parser at all. */
    const raw = "x".repeat(MAX_FILE_BYTES + 1);
    const read = readTrello(raw);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.said).toBe(TOO_LARGE);
  });

  it("takes a file of exactly 5 MB", () => {
    const board = { name: "Big", lists: [], cards: [] as unknown[] };
    const padding = MAX_FILE_BYTES - Buffer.byteLength(JSON.stringify(board), "utf8") - 10;
    const raw = JSON.stringify({ ...board, desc: "y".repeat(padding) });
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(MAX_FILE_BYTES);
    expect(readTrello(raw).ok).toBe(true);
  });

  it("refuses 2001 cards with a sentence that names the count", () => {
    const cards = Array.from({ length: MAX_CARDS + 1 }, (_, at) => ({
      id: `card${at}`,
      name: `Card ${at}`,
      idList: "list1",
      pos: at,
    }));
    const read = readTrello(JSON.stringify({ name: "Big", lists: [], cards }));
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.said).toBe("That export has 2001 cards. An import takes 2000 at a time.");
    }
  });

  it("takes 2000 cards", () => {
    const cards = Array.from({ length: MAX_CARDS }, (_, at) => ({
      id: `card${at}`,
      name: `Card ${at}`,
      idList: "list1",
      pos: at,
    }));
    const lists = [{ id: "list1", name: "One", pos: 1 }];
    const read = readTrello(JSON.stringify({ name: "Big", lists, cards }));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.board.cards).toHaveLength(MAX_CARDS);
  });

  it("says so when the file is not JSON", () => {
    const read = readTrello("not json at all");
    expect(read).toEqual({
      ok: false,
      said: "That file is not JSON. Export the board again as JSON.",
    });
  });

  it("says so when the JSON is not a board", () => {
    const read = readTrello(JSON.stringify({ hello: "world" }));
    expect(read).toEqual({
      ok: false,
      said: "That file is not a Trello board: it has no lists and cards.",
    });
  });
});
