import { describe, expect, it } from "vitest";
import { INVITE_IS_DEAD, INVITE_MS, inviteIsLive } from "@/lib/invite-link";

const MADE = new Date("2026-10-01T12:00:00Z");
const link = { hash: "abc", expiresAt: new Date(MADE.getTime() + INVITE_MS) };

describe("an invite link", () => {
  it("works for 7 days and not a moment longer", () => {
    expect(INVITE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(inviteIsLive(link, new Date("2026-10-08T11:59:59Z"))).toBe(true);
    expect(inviteIsLive(link, new Date("2026-10-08T12:00:00Z"))).toBe(false);
  });

  it("an invite made before links opens nothing", () => {
    expect(inviteIsLive({ hash: null, expiresAt: null }, MADE)).toBe(false);
  });

  it("a dead one says to ask for a new invite", () => {
    expect(INVITE_IS_DEAD).toContain("Ask the person who invited you for a new invite.");
  });
});
