"use client";

import { useEffect, useState } from "react";
import { elapsed } from "@/lib/run-state";

/**
 * The time since a run started, as words, refreshed every second. Only a card
 * that carries a live run mounts this, so a quiet board runs no timer at all.
 */
export function useElapsed(fromISO: string, live = true): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  return elapsed(fromISO, now);
}
