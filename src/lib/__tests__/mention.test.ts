import { describe, expect, it } from "vitest";
import { insertMention, mentionAt, mentionsFor, MENTION_LIMIT } from "../mention";
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
