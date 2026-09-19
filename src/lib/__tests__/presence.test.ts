import { describe, expect, it } from "vitest";
import { isListening, LISTEN_LEASE_MS, listeningAgents } from "../presence";
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
