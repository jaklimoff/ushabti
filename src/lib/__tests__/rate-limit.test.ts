import { describe, expect, it } from "vitest";
import {
  addressOf,
  createLimiter,
  retryAfterSeconds,
  TRIES,
  tooManyMessage,
  WINDOW_MS,
} from "../rate-limit";

/** A moment to count from. The clock is an argument, so no test waits. */
const T0 = Date.UTC(2026, 8, 20, 9, 0, 0);

const MINUTE = 60_000;

function fail(limiter: ReturnType<typeof createLimiter>, key: string, times: number, at: number) {
  for (let i = 0; i < times; i += 1) limiter.hit(key, at);
}

describe("the limiter", () => {
  it("allows the tries and refuses the one after them", () => {
    const limiter = createLimiter();
    fail(limiter, "login:ip:10.0.0.1", TRIES - 1, T0);
    expect(limiter.limited("login:ip:10.0.0.1", T0)).toBe(false);

    limiter.hit("login:ip:10.0.0.1", T0);
    expect(limiter.limited("login:ip:10.0.0.1", T0)).toBe(true);
  });

  it("counts each key on its own", () => {
    const limiter = createLimiter();
    fail(limiter, "login:email:ada@example.com", TRIES, T0);
    expect(limiter.limited("login:email:ada@example.com", T0)).toBe(true);
    expect(limiter.limited("login:email:grace@example.com", T0)).toBe(false);
    expect(limiter.limited("login:ip:10.0.0.1", T0)).toBe(false);
  });

  it("says how long is left, counting from the oldest failure", () => {
    const limiter = createLimiter();
    fail(limiter, "signup:ip:10.0.0.1", TRIES, T0);

    expect(limiter.waitMs("signup:ip:10.0.0.1", T0)).toBe(WINDOW_MS);
    expect(limiter.waitMs("signup:ip:10.0.0.1", T0 + 2 * MINUTE)).toBe(WINDOW_MS - 2 * MINUTE);
    // A key with tries left waits for nothing.
    expect(limiter.waitMs("signup:ip:10.0.0.2", T0)).toBe(0);
  });

  it("forgets a failure once the window has passed", () => {
    const limiter = createLimiter();
    fail(limiter, "token:ip:10.0.0.1", TRIES, T0);
    expect(limiter.limited("token:ip:10.0.0.1", T0 + WINDOW_MS - 1)).toBe(true);
    expect(limiter.limited("token:ip:10.0.0.1", T0 + WINDOW_MS + 1)).toBe(false);
  });

  it("lets the count slide, so ten spread over an hour never trip it", () => {
    const limiter = createLimiter();
    for (let i = 0; i < TRIES * 3; i += 1) limiter.hit("login:ip:10.0.0.1", T0 + i * 5 * MINUTE);
    expect(limiter.limited("login:ip:10.0.0.1", T0 + TRIES * 3 * 5 * MINUTE)).toBe(false);
  });

  it("drops an old key on the next write, so memory does not grow", () => {
    const limiter = createLimiter();
    fail(limiter, "login:ip:10.0.0.1", TRIES, T0);
    expect(limiter.size()).toBe(1);

    // Nothing runs on a timer: the sweep happens the next time anything writes.
    limiter.hit("login:ip:10.0.0.2", T0 + WINDOW_MS + 1);
    expect(limiter.size()).toBe(1);
    expect(limiter.limited("login:ip:10.0.0.1", T0 + WINDOW_MS + 1)).toBe(false);
  });

  it("keeps at most one row of tries for a key that is being hammered", () => {
    const limiter = createLimiter();
    fail(limiter, "login:ip:10.0.0.1", TRIES * 5, T0);
    expect(limiter.limited("login:ip:10.0.0.1", T0)).toBe(true);
    expect(limiter.waitMs("login:ip:10.0.0.1", T0)).toBe(WINDOW_MS);
  });

  it("forgets a key that is cleared, which is what a good password does", () => {
    const limiter = createLimiter();
    fail(limiter, "login:email:ada@example.com", TRIES, T0);
    limiter.clear("login:email:ada@example.com");
    expect(limiter.limited("login:email:ada@example.com", T0)).toBe(false);
    expect(limiter.size()).toBe(0);
  });
});

describe("what the caller is told", () => {
  it("rounds the wait up to whole minutes and says one of them properly", () => {
    expect(tooManyMessage(10 * MINUTE)).toBe("Too many tries. Wait 10 minutes and try again.");
    expect(tooManyMessage(7 * MINUTE + 1)).toBe("Too many tries. Wait 8 minutes and try again.");
    expect(tooManyMessage(20_000)).toBe("Too many tries. Wait 1 minute and try again.");
    expect(tooManyMessage(0)).toBe("Too many tries. Wait 1 minute and try again.");
  });

  it("rounds Retry-After up to whole seconds and never says zero", () => {
    expect(retryAfterSeconds(10 * MINUTE)).toBe(600);
    expect(retryAfterSeconds(1_400)).toBe(2);
    expect(retryAfterSeconds(0)).toBe(1);
  });
});

describe("the address", () => {
  const headers = (value: string | null) => ({ get: () => value });

  it("takes the client, which is the first value", () => {
    expect(addressOf(headers("203.0.113.7, 70.41.3.18, 150.172.238.178"))).toBe("203.0.113.7");
    expect(addressOf(headers("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("answers something rather than nothing when the header is missing", () => {
    // One bucket for the unknown is right: it slows them and blames nobody.
    expect(addressOf(headers(null))).toBe("unknown");
    expect(addressOf(headers("  "))).toBe("unknown");
  });
});
