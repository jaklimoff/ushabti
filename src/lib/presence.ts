import type { MemberDTO } from "./types";

/*
 * An agent is listening while it holds the project stream open. That is the
 * only thing that makes it hear a new task, so it is the only thing the word
 * may mean. A token that made a call yesterday is not listening; a watcher
 * with its socket open is.
 *
 * The server cannot see the other machine, so this is a lease, exactly like a
 * run's. The stream writes the moment while it lives, and the board compares
 * that moment with the clock. A process that died without closing its socket
 * falls off by itself, and nothing has to clean it up.
 */

/** How often an open stream says it is still open. The stream's own ping. */
export const LISTEN_TOUCH_MS = 25_000;

/** Two missed touches and a margin. Under this, the stream is there. */
export const LISTEN_LEASE_MS = 60_000;

export function isListening(listeningAt: string | null | undefined, now: number = Date.now()) {
  if (!listeningAt) return false;
  return now - new Date(listeningAt).getTime() < LISTEN_LEASE_MS;
}

/** The agents that would hear a task created now, in the members' order. */
export function listeningAgents(members: MemberDTO[], now: number = Date.now()): MemberDTO[] {
  return members.filter((m) => m.kind === "agent" && isListening(m.listeningAt, now));
}
