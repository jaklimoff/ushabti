/*
 * One board read out at a time for each tab, and at most one waiting.
 *
 * A board read is the whole board, and the server does every read it is sent,
 * even one whose answer `trackWrites` will throw away. When rings came faster
 * than reads were answered, a slow server got a growing pile from each tab.
 * So while a read is out, an ask waits behind it, and any number of asks made
 * meanwhile share the one read sent once it settles, answered or failed.
 *
 * The waiting read goes through `later`, which is the newest `refresh`, so it
 * reads with what the board says by then. A caller that awaited a waiting ask
 * is answered when that read settles, never by the read that was already out:
 * that one may be from before whatever the caller just wrote.
 *
 * A read that hangs holds the next one until the request runs out of time.
 * There is no cancel, because the server would do a cancelled read anyway.
 */

export type OneRead = {
  /**
   * Runs `read` now if no read is out. Otherwise waits behind the one that is,
   * and settles with the read sent after it.
   */
  ask: (read: () => Promise<void>) => Promise<void>;
};

export function oneRead(later: () => Promise<void>): OneRead {
  let out = false;
  let waiting: { promise: Promise<void>; settle: (read: Promise<void>) => void } | null = null;

  const next = () => {
    out = false;
    const owed = waiting;
    if (!owed) return;
    waiting = null;
    owed.settle(later());
  };

  return {
    ask(read) {
      if (!out) {
        /* Out before it starts, so an ask made from inside it waits. */
        out = true;
        let running: Promise<void>;
        try {
          running = read();
        } catch (err) {
          running = Promise.reject(err);
        }
        return running.finally(next);
      }
      if (!waiting) {
        let settle!: (read: Promise<void>) => void;
        const promise = new Promise<void>((resolve) => (settle = resolve));
        waiting = { promise, settle };
      }
      return waiting.promise;
    },
  };
}
