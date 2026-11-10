"use client";

/*
 * A stream that comes back after it is closed for good.
 *
 * An EventSource reconnects by itself after a dropped socket, but a reconnect
 * that meets anything but a 200 closes it for good: that is the spec. While
 * the server restarts for a deploy the ingress answers 502 or 503, so every
 * open tab went quiet until somebody reloaded it. So a source that is closed
 * opens a new one after a wait that grows and is jittered, so a hundred tabs
 * do not all knock in the same second. The wait starts over once a source
 * says `ready`, which is also where its page reads what it missed.
 */

/** The first wait, and the longest. */
const FIRST_MS = 2_000;
const LONGEST_MS = 30_000;
/** `EventSource.CLOSED`, which a stand-in for the class may not carry. */
const CLOSED = 2;

/**
 * How long to wait before the next try, counted from 0. Half of it is
 * jitter: the wait lands between half and the whole of the step.
 */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(LONGEST_MS, FIRST_MS * 2 ** Math.max(0, attempt));
  return Math.round(step / 2 + (step / 2) * random());
}

/**
 * Opens a source with `open`, hands it to `attach`, and opens another when
 * it is closed for good. `attach` gives back what lets the source go; the new
 * source is attached before the old one is let go, so a page that lends its
 * stream lends the new one without a moment of lending none. Gives back what
 * stops it all.
 */
export function keepOpen(
  open: () => EventSource,
  attach: (source: EventSource) => () => void,
): () => void {
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let source: EventSource | null = null;
  let detach: (() => void) | null = null;

  const start = () => {
    timer = null;
    if (stopped) return;
    const next = open();
    const nextDetach = attach(next);
    const old = detach;
    source = next;
    detach = nextDetach;
    old?.();
    next.addEventListener("ready", () => {
      attempt = 0;
    });
    next.addEventListener("error", () => {
      /* CONNECTING is the source trying again by itself; only CLOSED is for good. */
      if (stopped || source !== next || next.readyState !== CLOSED) return;
      if (timer) return;
      timer = setTimeout(start, backoff(attempt));
      attempt += 1;
    });
  };
  start();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    detach?.();
    source?.close();
  };
}
