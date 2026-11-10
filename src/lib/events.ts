import "server-only";
import { Client } from "pg";
import { pool } from "@/db";
import { directDatabaseUrl } from "@/db/url";
import type { PresenceSaid } from "./presence";

const CHANNEL = "ushabti_events";

export type BoardEvent = {
  projectId: string;
  /** board = columns, tasks or properties moved. task = one task changed. */
  scope: "board" | "task" | "project";
  taskId?: string;
  /** The browser tab that caused the change. It skips its own echo. */
  clientId?: string;
  /** The agent whose name changed, so its watcher reads the name again. */
  renamed?: string;
};

/**
 * Which task a person's tab has open. It is not a doorbell: it carries its
 * data, because nothing stores it and there is nothing to read afterwards.
 * The stream sends it as `presence`, never as `change`, so it makes no board
 * read the board again.
 */
export type PresenceEvent = PresenceSaid & { projectId: string; kind: "presence" };

export type StreamEvent = BoardEvent | PresenceEvent;

export function isPresence(event: StreamEvent): event is PresenceEvent {
  return "kind" in event && event.kind === "presence";
}

type Listener = (event: StreamEvent) => void;

/** The part of a pg `Client` the hub uses, so a test can hand it a fake. */
export type ListenClient = {
  on(event: "error" | "end", fn: () => void): unknown;
  on(event: "notification", fn: (msg: { payload?: string }) => void): unknown;
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
};

/** The first wait after a drop, doubled on each failure up to the last. */
export const RETRY_FIRST_MS = 500;
export const RETRY_MAX_MS = 30_000;

export type Hub = {
  subscribe(projectId: string, fn: Listener): Promise<() => void>;
  /** Whether LISTEN is up right now. `/api/health` says it. */
  listening(): boolean;
};

/**
 * One LISTEN connection for the whole process, shared by every stream.
 *
 * A connection drops: the database restarts, a proxy cuts an idle socket.
 * While anybody listens, the hub closes what is left of it and connects
 * again, waiting longer after each failure. Whatever was said while it was
 * down is gone, so once it is back every project rings once as a board
 * change: a browser reads the board and an agent its feed, which is what
 * they do on `ready` too.
 */
export function makeHub(open: () => ListenClient): Hub {
  const listeners = new Map<string, Set<Listener>>();
  let client: ListenClient | null = null;
  let connecting: Promise<void> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  /* Something may have been said that nobody heard. */
  let lost = false;

  const ringAll = () => {
    for (const [projectId, set] of listeners) {
      for (const fn of [...set]) fn({ projectId, scope: "board" });
    }
  };

  const later = () => {
    if (retry || listeners.size === 0) return;
    const wait = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** failures);
    failures += 1;
    retry = setTimeout(() => {
      retry = null;
      if (listeners.size === 0) return;
      void connect();
    }, wait);
    retry.unref?.();
  };

  const connect = (): Promise<void> => {
    if (client) return Promise.resolve();
    if (connecting) return connecting;
    const next = open();
    let gone = false;
    /* Only the client that is live may give up its place. A late `end` from
       an old one must not touch the one that took over. */
    const drop = () => {
      if (gone) return;
      gone = true;
      if (client !== next) return;
      client = null;
      lost = true;
      void next.end().catch(() => {});
      later();
    };
    next.on("error", drop);
    next.on("end", drop);
    next.on("notification", (msg) => {
      if (client !== next || !msg.payload) return;
      let event: StreamEvent;
      try {
        event = JSON.parse(msg.payload) as StreamEvent;
      } catch {
        return;
      }
      const set = listeners.get(event.projectId);
      if (!set) return;
      for (const fn of [...set]) fn(event);
    });
    connecting = (async () => {
      try {
        await next.connect();
        await next.query(`LISTEN ${CHANNEL}`);
      } catch (err) {
        gone = true;
        lost = true;
        void next.end().catch(() => {});
        console.error(
          JSON.stringify({ at: "listen", error: err instanceof Error ? err.message : String(err) }),
        );
        later();
        return;
      } finally {
        connecting = null;
      }
      if (gone) {
        /* It dropped between the LISTEN and here. */
        lost = true;
        later();
        return;
      }
      client = next;
      failures = 0;
      if (lost) {
        lost = false;
        ringAll();
      }
    })();
    return connecting;
  };

  return {
    async subscribe(projectId, fn) {
      let set = listeners.get(projectId);
      if (!set) {
        set = new Set();
        listeners.set(projectId, set);
      }
      set.add(fn);
      /* A first connect that fails still leaves the stream subscribed: the
         retry rings it once LISTEN is back. While a retry waits, it is the
         retry that connects. */
      if (!retry) await connect();
      const mine = set;
      return () => {
        mine.delete(fn);
        if (mine.size === 0 && listeners.get(projectId) === mine) listeners.delete(projectId);
      };
    },
    listening: () => client !== null,
  };
}

const globalForHub = globalThis as unknown as { __ushabtiListenHub?: Hub };

const hub: Hub =
  globalForHub.__ushabtiListenHub ??
  (globalForHub.__ushabtiListenHub = makeHub(
    () => new Client({ connectionString: directDatabaseUrl(), keepAlive: true }),
  ));

export function subscribe(projectId: string, fn: Listener): Promise<() => void> {
  return hub.subscribe(projectId, fn);
}

/** Whether this process hears changes right now. */
export function hearsChanges(): boolean {
  return hub.listening();
}

export async function publish(event: StreamEvent): Promise<void> {
  try {
    await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(event)]);
  } catch {
    // A failed broadcast must never break the write that caused it.
  }
}
