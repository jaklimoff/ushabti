import "server-only";
import { Client } from "pg";
import { pool } from "@/db";
import { databaseUrl } from "@/db/url";
import type { PresenceSaid } from "./presence";

const CHANNEL = "ushabti_events";

export type BoardEvent = {
  projectId: string;
  /** board = columns, tasks or properties moved. task = one task changed. */
  scope: "board" | "task" | "project";
  taskId?: string;
  /** The browser tab that caused the change. It skips its own echo. */
  clientId?: string;
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

type Hub = {
  listeners: Map<string, Set<Listener>>;
  client: Client | null;
  connecting: Promise<void> | null;
};

const globalForHub = globalThis as unknown as { __ushabtiHub?: Hub };

const hub: Hub =
  globalForHub.__ushabtiHub ??
  (globalForHub.__ushabtiHub = { listeners: new Map(), client: null, connecting: null });

async function ensureListener(): Promise<void> {
  if (hub.client) return;
  if (hub.connecting) return hub.connecting;

  hub.connecting = (async () => {
    const client = new Client({ connectionString: databaseUrl() });
    client.on("error", () => {
      hub.client = null;
      hub.connecting = null;
    });
    client.on("end", () => {
      hub.client = null;
      hub.connecting = null;
    });
    client.on("notification", (msg) => {
      if (!msg.payload) return;
      let event: StreamEvent;
      try {
        event = JSON.parse(msg.payload) as StreamEvent;
      } catch {
        return;
      }
      const set = hub.listeners.get(event.projectId);
      if (!set) return;
      for (const fn of set) fn(event);
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    hub.client = client;
  })();

  try {
    await hub.connecting;
  } finally {
    hub.connecting = null;
  }
}

export async function subscribe(projectId: string, fn: Listener): Promise<() => void> {
  await ensureListener();
  let set = hub.listeners.get(projectId);
  if (!set) {
    set = new Set();
    hub.listeners.set(projectId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) hub.listeners.delete(projectId);
  };
}

export async function publish(event: StreamEvent): Promise<void> {
  try {
    await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(event)]);
  } catch {
    // A failed broadcast must never break the write that caused it.
  }
}
