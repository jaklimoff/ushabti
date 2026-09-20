/**
 * Slows a guessing attack on sign-in, sign-up and agent tokens.
 *
 * It counts failures and never successes. The people who sign in every morning
 * must never meet it, and a team signing up on its first day would otherwise
 * spend the budget of the address they all share.
 *
 * Everything is in memory. One server is the only deployment today, so a count
 * per process is enough; two processes would each keep a count of their own.
 * Nothing here reads the database, the clock is an argument, and the numbers
 * are not configurable, so a unit test drives the whole rule.
 */

/** How many failures one key may carry before it is refused. */
export const TRIES = 10;

/** How long one failure is remembered. */
export const WINDOW_MS = 10 * 60 * 1000;

export type Limiter = {
  /** Counts one failure against this key. */
  hit(key: string, now?: number): void;
  /** Whether this key has spent its tries. */
  limited(key: string, now?: number): boolean;
  /** How long until this key has a try again. Zero while it has one. */
  waitMs(key: string, now?: number): number;
  /** Forgets this key. A success on sign-in does this to the email. */
  clear(key: string): void;
  /** How many keys are remembered. The test reads it; nothing else does. */
  size(): number;
};

export function createLimiter(): Limiter {
  /** A key, and the moments it failed: oldest first, at most `TRIES` of them. */
  const failures = new Map<string, number[]>();

  const live = (times: number[], now: number) => times.filter((at) => at > now - WINDOW_MS);

  const within = (key: string, now: number) => live(failures.get(key) ?? [], now);

  return {
    hit(key, now = Date.now()) {
      /* Sweep on write, so an address nobody tried again is forgotten without
         a timer to run. A handful of keys are ever in here, so walking all of
         them costs less than the bookkeeping that would avoid it. */
      for (const [other, times] of failures) {
        const kept = live(times, now);
        if (kept.length) failures.set(other, kept);
        else failures.delete(other);
      }

      const times = within(key, now);
      times.push(now);
      // The count never has to climb above the limit, and this bounds the row.
      failures.set(key, times.slice(-TRIES));
    },

    limited(key, now = Date.now()) {
      return within(key, now).length >= TRIES;
    },

    waitMs(key, now = Date.now()) {
      const times = within(key, now);
      if (times.length < TRIES) return 0;
      // The key has a try again when the oldest of the tries is forgotten.
      return times[times.length - TRIES] + WINDOW_MS - now;
    },

    clear(key) {
      failures.delete(key);
    },

    size() {
      return failures.size;
    },
  };
}

/** The one limiter this process counts in. */
export const limiter = createLimiter();

/* The five keys. They live together so that nothing else invents a sixth. */
export const loginByAddress = (address: string) => `login:ip:${address}`;
export const loginByEmail = (email: string) => `login:email:${email}`;
export const signupByAddress = (address: string) => `signup:ip:${address}`;
export const tokenByAddress = (address: string) => `token:ip:${address}`;
/* A reset link is a long random token, so this counts a stranger walking the
   address space. There is no key for the account: the address is all a dead
   link tells us, and a key per account would say that the account is real. */
export const resetByAddress = (address: string) => `reset:ip:${address}`;

/**
 * Who is calling.
 *
 * In production Ushabti sits behind a proxy, which says who the client is in
 * `x-forwarded-for`; the first value is the client and the rest are the
 * proxies it came through. With no proxy Next fills the same header in from
 * the socket, so one header answers both deployments.
 */
export function addressOf(headers: { get(name: string): string | null }): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}

/** What a `Retry-After` header says: whole seconds, never zero. */
export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/** What the person reads. It says how long, because "later" helps nobody. */
export function tooManyMessage(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `Too many tries. Wait ${minutes} ${minutes === 1 ? "minute" : "minutes"} and try again.`;
}
