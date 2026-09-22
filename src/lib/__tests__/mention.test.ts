import { describe, expect, it } from "vitest";
import {
  insertMention,
  mentionAt,
  mentionHeight,
  mentionOpensUp,
  mentionRoom,
  mentionsFor,
  MENTION_LIMIT,
  MENTION_ROW,
} from "../mention";
import { LISTEN_LEASE_MS } from "../presence";
import type { MemberDTO } from "../types";

const now = new Date("2026-09-21T09:00:00Z").getTime();
const ago = (ms: number) => new Date(now - ms).toISOString();

function member(over: Partial<MemberDTO>): MemberDTO {
  return {
    id: "m",
    name: "Builder",
    email: null,
    color: "#3fb0c8",
    role: "member",
    kind: "agent",
    listeningAt: null,
    ...over,
  };
}

const MEMBERS = [
  member({ id: "p1", name: "Ada Lovelace", kind: "human", email: "ada@example.com" }),
  member({ id: "a1", name: "Code Worker", listeningAt: ago(5_000) }),
  member({ id: "p2", name: "Bob Codd", kind: "human", email: "bob@example.com" }),
  member({ id: "a2", name: "Builder", listeningAt: ago(LISTEN_LEASE_MS * 3) }),
];

const names = (query: string) => mentionsFor(MEMBERS, query, now).map((m) => m.member.name);

describe("the word the caret is in", () => {
  it("finds the letters after an @ at the start of a word", () => {
    expect(mentionAt("@bui", 4)).toEqual({ start: 0, query: "bui" });
    expect(mentionAt("Ask @bui about it", 8)).toEqual({ start: 4, query: "bui" });
    expect(mentionAt("line one\n@bui", 13)).toEqual({ start: 9, query: "bui" });
  });

  it("opens on the @ alone, before a letter is typed", () => {
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("says nothing about an @ inside a word, so an address offers no names", () => {
    expect(mentionAt("ada@example", 11)).toBeNull();
  });

  it("ends the word at a space, so a picked name closes the list", () => {
    expect(mentionAt("@Code Worker ", 13)).toBeNull();
    expect(mentionAt("@Code and", 9)).toBeNull();
  });

  it("reads the caret and not the end of the box", () => {
    expect(mentionAt("@bui and more", 4)).toEqual({ start: 0, query: "bui" });
    expect(mentionAt("nothing here", 5)).toBeNull();
  });

  it("takes the nearest @ when there are two", () => {
    expect(mentionAt("@Ada said @bu", 13)).toEqual({ start: 10, query: "bu" });
  });
});

describe("who the letters can name", () => {
  it("offers the agents first, then the people, each in the members' order", () => {
    expect(names("")).toEqual(["Code Worker", "Builder", "Ada Lovelace", "Bob Codd"]);
  });

  it("narrows by the start of the name", () => {
    expect(names("bu")).toEqual(["Builder"]);
    expect(names("ada")).toEqual(["Ada Lovelace"]);
  });

  it("narrows by the start of any word, so a second name is enough", () => {
    expect(names("wor")).toEqual(["Code Worker"]);
    expect(names("cod")).toEqual(["Code Worker", "Bob Codd"]);
  });

  it("ignores the case of what was typed", () => {
    expect(names("BUILD")).toEqual(["Builder"]);
  });

  it("never matches the middle of a word", () => {
    expect(names("ork")).toEqual([]);
    expect(names("zz")).toEqual([]);
  });

  it("marks the agent that would hear a task now", () => {
    const found = mentionsFor(MEMBERS, "", now);
    expect(found.map((m) => m.listening)).toEqual([true, false, false, false]);
  });

  it("keeps the list short, whatever the size of the team", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      member({ id: `x${i}`, name: `Agent ${i}`, kind: "human", email: `x${i}@example.com` }),
    );
    expect(mentionsFor(many, "", now)).toHaveLength(MENTION_LIMIT);
  });
});

describe("what picking a name writes", () => {
  it("puts the whole name and a space where the letters were", () => {
    expect(insertMention("@bui", 4, "Builder")).toEqual({ text: "@Builder ", caret: 9 });
  });

  it("keeps a name with a space whole, because that is what wakes the agent", () => {
    expect(insertMention("Ask @cod", 8, "Code Worker")).toEqual({
      text: "Ask @Code Worker ",
      caret: 17,
    });
  });

  it("writes at the caret and leaves the rest of the words alone", () => {
    expect(insertMention("Ask @cod to look", 8, "Code Worker")).toEqual({
      text: "Ask @Code Worker to look",
      caret: 17,
    });
  });

  it("writes nothing when the caret is not in a name", () => {
    expect(insertMention("nothing here", 12, "Builder")).toBeNull();
  });
});

describe("which side the list opens on", () => {
  /* A screen 900 tall, and a box somewhere on it. */
  const screen = { top: 0, bottom: 900 };

  it("opens under the box when the rows fit there", () => {
    expect(mentionOpensUp({ top: 200, bottom: 240 }, screen, 8)).toBe(false);
  });

  it("opens above it when the box is on the bottom edge", () => {
    // The comment box of a task with a few notes, at the foot of the panel.
    expect(mentionOpensUp({ top: 820, bottom: 880 }, screen, 2)).toBe(true);
  });

  it("counts the rows, so a long list flips where a short one does not", () => {
    const box = { top: 660, bottom: 700 };
    expect(mentionOpensUp(box, screen, 2)).toBe(false);
    expect(mentionOpensUp(box, screen, 8)).toBe(true);
  });

  it("stays under the box when there is no more room above", () => {
    expect(mentionOpensUp({ top: 10, bottom: 40 }, { top: 0, bottom: 60 }, 8)).toBe(false);
  });

  it("measures against what scrolls, not against the whole screen", () => {
    // The body of the panel ends at 500; the screen goes on to 900.
    const box = { top: 430, bottom: 470 };
    expect(mentionOpensUp(box, screen, 4)).toBe(false);
    expect(mentionOpensUp(box, { top: 100, bottom: 500 }, 4)).toBe(true);
  });

  it("is as tall as the side it is on, and never shorter than a row", () => {
    const box = { top: 400, bottom: 440 };
    expect(mentionRoom(box, screen, false)).toBe(900 - 440 - 4);
    expect(mentionRoom(box, screen, true)).toBe(400 - 4);
    expect(mentionRoom({ top: 0, bottom: 10 }, screen, true)).toBe(MENTION_ROW);
  });

  it("grows a row at a time", () => {
    expect(mentionHeight(0)).toBe(0);
    expect(mentionHeight(2) - mentionHeight(1)).toBe(MENTION_ROW + 1);
  });
});
