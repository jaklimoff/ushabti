import { describe, expect, it } from "vitest";
import { lifeOfLink, LINK_IS_DEAD, RESET_HOURS, RESET_MS, type StoredLink } from "../reset-link";

/** A moment to count from. The clock is an argument, so no test waits. */
const NOW = new Date(Date.UTC(2026, 8, 20, 9, 0, 0));

const HOUR = 60 * 60 * 1000;

function madeAt(offsetMs: number, patch: Partial<StoredLink> = {}): StoredLink {
  const createdAt = new Date(NOW.getTime() + offsetMs);
  return {
    createdAt,
    expiresAt: new Date(createdAt.getTime() + RESET_MS),
    usedAt: null,
    ...patch,
  };
}

describe("the life of a reset link", () => {
  it("is live while it is the newest, unused and inside the day", () => {
    const link = madeAt(-HOUR);
    expect(lifeOfLink(link, link.createdAt, NOW)).toBe("live");
  });

  it("is used once somebody set a password with it", () => {
    const link = madeAt(-HOUR, { usedAt: new Date(NOW.getTime() - 30 * 60_000) });
    expect(lifeOfLink(link, link.createdAt, NOW)).toBe("used");
  });

  it("is expired after a day, to the second", () => {
    const old = madeAt(-RESET_MS - 1);
    expect(lifeOfLink(old, old.createdAt, NOW)).toBe("expired");

    // The last second of the day still works. Twenty-four hours means this.
    const justInside = madeAt(-RESET_MS + 1000);
    expect(lifeOfLink(justInside, justInside.createdAt, NOW)).toBe("live");
    expect(RESET_HOURS).toBe(24);
  });

  it("is superseded the moment a newer link is made for the same person", () => {
    const first = madeAt(-2 * HOUR);
    const second = madeAt(-HOUR);

    expect(lifeOfLink(first, second.createdAt, NOW)).toBe("superseded");
    expect(lifeOfLink(second, second.createdAt, NOW)).toBe("live");
  });

  it("calls a link used before it calls it superseded or old", () => {
    /* All three are dead and read the same on screen. The order only has to be
       settled, so that a log line says one thing and not three. */
    const spent = madeAt(-3 * HOUR, { usedAt: new Date(NOW.getTime() - 2 * HOUR) });
    expect(lifeOfLink(spent, new Date(NOW.getTime() - HOUR), NOW)).toBe("used");
  });

  it("says nothing about the account when a link is dead", () => {
    expect(LINK_IS_DEAD).not.toMatch(/account|email/i);
  });
});
