import { describe, expect, it } from "vitest";
import {
  expirePresence,
  isListening,
  LISTEN_LEASE_MS,
  listeningAgents,
  mergePresence,
  peopleOn,
  type PresenceSaid,
  type Room,
} from "../presence";
import type { MemberDTO } from "../types";

const now = new Date("2026-09-18T12:00:00Z").getTime();
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

describe("an agent that listens", () => {
  it("listens while the stream has touched the lease", () => {
    expect(isListening(ago(0), now)).toBe(true);
    expect(isListening(ago(LISTEN_LEASE_MS - 1), now)).toBe(true);
  });

  it("stops listening when the touches stop, with nobody to clean up", () => {
    expect(isListening(ago(LISTEN_LEASE_MS), now)).toBe(false);
    expect(isListening(ago(3_600_000), now)).toBe(false);
  });

  it("does not listen if it never opened the stream", () => {
    expect(isListening(null, now)).toBe(false);
    expect(isListening(undefined, now)).toBe(false);
  });

  it("names only the agents, in the members' order", () => {
    const members = [
      member({ id: "a", name: "Builder", listeningAt: ago(5_000) }),
      member({ id: "b", name: "Scribe", listeningAt: ago(LISTEN_LEASE_MS * 2) }),
      member({ id: "c", name: "Refiner", listeningAt: ago(1_000) }),
      // A person's value is always null, but the rule must not trust that.
      member({ id: "d", name: "Ada", kind: "human", listeningAt: ago(1_000) }),
    ];
    expect(listeningAgents(members, now).map((m) => m.name)).toEqual(["Builder", "Refiner"]);
  });
});

describe("a person on a task", () => {
  const said = (over: Partial<PresenceSaid>): PresenceSaid => ({
    clientId: "tab-1",
    userId: "ada",
    taskId: "t1",
    field: null,
    ...over,
  });

  function roomOf(...heard: [PresenceSaid, number][]): Room {
    let room: Room = {};
    for (const [s, at] of heard) room = mergePresence(room, s, at).room;
    return room;
  }

  it("calls a tab it never heard a stranger, and only the first time", () => {
    const first = mergePresence({}, said({}), now);
    expect(first.stranger).toBe(true);
    const again = mergePresence(first.room, said({ taskId: null }), now + 1_000);
    expect(again.stranger).toBe(false);
    expect(again.room["tab-1"]).toMatchObject({ taskId: null, heardAt: now + 1_000 });
  });

  it("keeps when a tab came to the task while it stays there", () => {
    let room = mergePresence({}, said({}), now).room;
    room = mergePresence(room, said({ field: "title" }), now + 25_000).room;
    expect(room["tab-1"].since).toBe(now);
    room = mergePresence(room, said({ taskId: "t2" }), now + 30_000).room;
    expect(room["tab-1"].since).toBe(now + 30_000);
  });

  it("drops a tab that has not been heard for the lease", () => {
    const room = roomOf(
      [said({ clientId: "old" }), now - LISTEN_LEASE_MS],
      [said({ clientId: "new" }), now - LISTEN_LEASE_MS + 1],
    );
    expect(Object.keys(expirePresence(room, now))).toEqual(["new"]);
  });

  it("hands back the same room when nothing expired", () => {
    const room = roomOf([said({}), now]);
    expect(expirePresence(room, now)).toBe(room);
  });

  it("shows two tabs of one person as one face", () => {
    const room = roomOf(
      [said({ clientId: "a1", userId: "ada" }), now],
      [said({ clientId: "a2", userId: "ada" }), now],
    );
    expect(peopleOn(room, "t1", "me", now)).toEqual(["ada"]);
  });

  it("never shows my own face, from any of my tabs", () => {
    const room = roomOf(
      [said({ clientId: "m1", userId: "me" }), now],
      [said({ clientId: "a1", userId: "ada" }), now],
    );
    expect(peopleOn(room, "t1", "me", now)).toEqual(["ada"]);
  });

  it("shows only the people on this task, in the order they came", () => {
    const room = roomOf(
      [said({ clientId: "b1", userId: "bo" }), now - 5_000],
      [said({ clientId: "a1", userId: "ada" }), now - 9_000],
      [said({ clientId: "c1", userId: "cy", taskId: "t2" }), now],
      [said({ clientId: "d1", userId: "di", taskId: null }), now],
    );
    expect(peopleOn(room, "t1", "me", now)).toEqual(["ada", "bo"]);
  });

  it("does not show a tab whose lease ran out before the sweep came", () => {
    const room = roomOf([said({}), now - LISTEN_LEASE_MS]);
    expect(peopleOn(room, "t1", "me", now)).toEqual([]);
  });
});
