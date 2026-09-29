import { describe, expect, it } from "vitest";
import { createLimiter, spendMail, TRIES, WINDOW_MS } from "@/lib/rate-limit";

/**
 * A send spends a try, so an open board cannot become somebody's mail relay:
 * a stranger who signs up, makes a project and invites address after address
 * runs out after ten, from their account and from their address alike.
 */
describe("spendMail", () => {
  const headers = (address: string) => new Headers({ "x-forwarded-for": address });

  it("lets ten sends through for one person, and refuses the eleventh", () => {
    const limiter = createLimiter();
    for (let i = 0; i < TRIES; i += 1) {
      expect(spendMail(limiter, headers("203.0.113.1"), "user-a", 1_000)).toBe(true);
    }
    expect(spendMail(limiter, headers("203.0.113.1"), "user-a", 1_000)).toBe(false);
    // The window passes, and the person may send again.
    expect(spendMail(limiter, headers("203.0.113.1"), "user-a", 1_000 + WINDOW_MS + 1)).toBe(true);
  });

  it("counts the person across addresses, and the address across accounts", () => {
    const limiter = createLimiter();
    for (let i = 0; i < TRIES; i += 1) {
      expect(spendMail(limiter, headers(`198.51.100.${i}`), "user-a", 1_000)).toBe(true);
    }
    expect(spendMail(limiter, headers("198.51.100.200"), "user-a", 1_000)).toBe(false);

    const shared = createLimiter();
    for (let i = 0; i < TRIES; i += 1) {
      expect(spendMail(shared, headers("203.0.113.9"), `user-${i}`, 1_000)).toBe(true);
    }
    expect(spendMail(shared, headers("203.0.113.9"), "user-new", 1_000)).toBe(false);
  });

  it("does not spend the person's try when the address refused it", () => {
    const limiter = createLimiter();
    for (let i = 0; i < TRIES; i += 1) spendMail(limiter, headers("203.0.113.9"), `u-${i}`, 1_000);
    expect(spendMail(limiter, headers("203.0.113.9"), "user-b", 1_000)).toBe(false);
    for (let i = 0; i < TRIES; i += 1) {
      expect(spendMail(limiter, headers(`192.0.2.${i}`), "user-b", 1_000)).toBe(true);
    }
  });
});
