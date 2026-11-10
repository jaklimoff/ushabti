/*
 * When an open board reads itself again. Every agent step, beat and listening
 * change rings the board's stream, and a read is the whole board and a lease
 * sweep on the server, so a ring costs one read where one is needed.
 *
 * Rings are gathered for a short burst, but the first of them never waits
 * longer than `RING_MAX_WAIT_MS`: a steady stream of rings, which an agent at work makes, would
 * otherwise keep a debounce waiting until it stopped.
 *
 * A hidden tab reads nothing, as Home's does. It remembers it was rung and
 * reads once when it is shown again.
 *
 * `ready` reads after a small random wait: after a restart every tab gets it
 * in the same moment, and would all read the board at once.
 */

/** How long a ring waits for the rest of its burst. */
export const RING_BURST_MS = 140;
/** The longest a ring waits, however many come after it. */
export const RING_MAX_WAIT_MS = 2_000;
/** The most `ready` waits before it reads. */
export const READY_JITTER_MS = 600;

/**
 * Which tasks a read was rung for: their ids, or null when a ring named none
 * and so may concern any of them.
 */
export type Rung = string[] | null;

/** The event an open panel hears after the board read for a ring. */
export const REMOTE_CHANGE = "ushabti:remote-change";
export type RemoteChange = { taskIds: Rung };

/**
 * Whether a panel has to load itself again. `shown` is the task it is open on
 * and every task it names: a link draws that task's title and whether it is
 * over, so a ring for it changes the panel too.
 */
export function concerns(rung: Rung | undefined, shown: readonly string[]): boolean {
  return !rung || rung.some((id) => shown.includes(id));
}

export type BoardReader = {
  /** Something changed on this board; `taskId` when the ring named one. */
  ring: (taskId?: string) => void;
  /** The stream said `ready`: it may have missed something. */
  ready: () => void;
  /** The tab was shown or hidden. */
  shown: () => void;
  stop: () => void;
};

export function boardReader({
  read,
  rung,
  hidden,
  now = () => Date.now(),
  random = Math.random,
  burst = RING_BURST_MS,
  most = RING_MAX_WAIT_MS,
  jitter = READY_JITTER_MS,
}: {
  /** Reads the board. */
  read: () => void;
  /** Tells the panel which tasks the read was rung for. */
  rung: (taskIds: Rung) => void;
  hidden: () => boolean;
  now?: () => number;
  random?: () => number;
  burst?: number;
  most?: number;
  jitter?: number;
}): BoardReader {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let first = 0;
  /* Rings not answered yet, and whether any of them named no task. */
  let named = new Set<string>();
  let any = false;
  let pending = false;
  /* The ready read, apart from rings, so a ring does not put it off. */
  let readyTimer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    timer = null;
    if (hidden()) return;
    const taskIds: Rung = any ? null : [...named];
    named = new Set();
    any = false;
    pending = false;
    read();
    rung(taskIds);
  };

  const note = (taskId?: string) => {
    if (taskId) named.add(taskId);
    else any = true;
    pending = true;
  };

  return {
    ring(taskId) {
      note(taskId);
      if (hidden()) return;
      const at = now();
      if (!timer) first = at;
      else clearTimeout(timer);
      timer = setTimeout(fire, Math.max(0, Math.min(burst, first + most - at)));
    },
    ready() {
      /* What was missed may be anything, so it names no task. */
      note();
      if (hidden()) return;
      if (readyTimer) clearTimeout(readyTimer);
      readyTimer = setTimeout(
        () => {
          readyTimer = null;
          if (timer) clearTimeout(timer);
          fire();
        },
        Math.floor(random() * jitter),
      );
    },
    shown() {
      if (hidden() || !pending || timer) return;
      first = now();
      timer = setTimeout(fire, 0);
    },
    stop() {
      if (timer) clearTimeout(timer);
      if (readyTimer) clearTimeout(readyTimer);
      timer = null;
      readyTimer = null;
    },
  };
}
