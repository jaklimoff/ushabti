"use client";

import { useEffect, useState } from "react";
import { elapsed } from "@/lib/run-state";

/**
 * The clock, refreshed every second. Only a card that carries a live run
 * mounts this, so a quiet board runs no timer at all.
 *
 * A run whose agent went silent needs the same clock: the board decides what
 * to call it from how long ago the agent last spoke, and that answer changes
 * while nothing else on the board does.
 */
export function useNow(live = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  return now;
}

/** The time since a moment, as words. */
export function useElapsed(fromISO: string, live = true): string {
  return elapsed(fromISO, useNow(live));
}
