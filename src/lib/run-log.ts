import type { AgentRunLogDTO } from "./types";

/**
 * Puts a fresh tail after the lines already held. The tail overlaps what is
 * held unless more than a tail's worth was written since the last read, and
 * then the caller is told where the gap starts so it can read across it.
 */
export function joinLog(
  held: AgentRunLogDTO[],
  tail: AgentRunLogDTO[],
): { lines: AgentRunLogDTO[]; gapBefore: string | null } {
  const known = new Set(held.map((line) => line.id));
  const fresh = tail.filter((line) => !known.has(line.id));
  const touches = tail.length === 0 || fresh.length < tail.length || held.length === 0;
  return { lines: [...held, ...fresh], gapBefore: touches ? null : tail[0].id };
}
