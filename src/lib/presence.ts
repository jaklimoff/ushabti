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

/*
 * A person is on a task while one of their tabs has its panel open. Nothing
 * stores that: a tab says where it is, the server relays it on the stream, and
 * every other tab keeps its own room. It is the same lease as the agent's,
 * held in the browser instead of a row. A tab says it again every
 * `LISTEN_TOUCH_MS`, and a tab that has not been heard for `LISTEN_LEASE_MS`
 * is gone, so a laptop that went to sleep with a task open lets go of it by
 * itself.
 */

/** What one tab says about itself. `field` is the box it is typing in, if any. */
export type PresenceSaid = {
  clientId: string;
  userId: string;
  taskId: string | null;
  field: string | null;
};

/** What a tab knows about another tab: what it said, and when. */
export type PresenceEntry = PresenceSaid & {
  /** The last time this tab was heard. The lease counts from here. */
  heardAt: number;
  /** When it came to this task. The faces stand in that order. */
  since: number;
};

/** Every other tab this tab has heard, by its client id. */
export type Room = Record<string, PresenceEntry>;

/**
 * Takes one message into the room. It answers whether the tab was new here,
 * because a tab that hears a stranger says where it is once more, and that
 * is how a tab that just opened learns the room in a second instead of 25.
 */
export function mergePresence(
  room: Room,
  said: PresenceSaid,
  now: number = Date.now(),
): { room: Room; stranger: boolean } {
  const before = room[said.clientId];
  const since = before && before.taskId === said.taskId ? before.since : now;
  return {
    room: { ...room, [said.clientId]: { ...said, heardAt: now, since } },
    stranger: !before,
  };
}

/** Drops every tab that has not been heard for the length of the lease. */
export function expirePresence(room: Room, now: number = Date.now()): Room {
  const kept = Object.entries(room).filter(([, e]) => now - e.heardAt < LISTEN_LEASE_MS);
  if (kept.length === Object.keys(room).length) return room;
  return Object.fromEntries(kept);
}

/**
 * The people on one task other than me, once each, in the order they came.
 * Two tabs of one person are one face, and my own tabs are never a face: I
 * know I am here.
 */
export function peopleOn(
  room: Room,
  taskId: string,
  meId: string,
  now: number = Date.now(),
): string[] {
  const first = new Map<string, number>();
  for (const e of Object.values(room)) {
    if (e.taskId !== taskId || e.userId === meId) continue;
    if (now - e.heardAt >= LISTEN_LEASE_MS) continue;
    const at = first.get(e.userId);
    if (at === undefined || e.since < at) first.set(e.userId, e.since);
  }
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

/**
 * A tab's client id, or null. The server only relays it, but it lands in
 * every other tab's room, so it is held to the shape a tab makes: a UUID, or
 * the short random word an old browser falls back to.
 */
export function readClientId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : null;
}
