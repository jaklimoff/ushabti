import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers } from "@/db/schema";
import { subscribe, type StreamEvent } from "./events";

async function memberOf(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  return new Set(rows.map((r) => r.projectId));
}

export type Following = {
  /**
   * Brings the subscriptions in line with the memberships, and names a
   * project that moved, or null. A stream calls it once before `ready` and
   * again on every ping, so a project joined or left starts or stops ringing
   * within one.
   */
  follow(): Promise<string | null>;
  close(): void;
};

/**
 * One person's subscriptions to every project they are a member of, but
 * `skip`. Home's stream and a person's project stream both follow through
 * here, so the two cannot disagree about which projects ring.
 */
export function followMemberships(
  userId: string,
  heard: (event: StreamEvent) => void,
  skip?: string,
): Following {
  const unsubscribes = new Map<string, () => void>();
  let closed = false;

  return {
    async follow() {
      const ids = await memberOf(userId);
      if (skip) ids.delete(skip);
      let moved: string | null = null;
      for (const [id, off] of unsubscribes) {
        if (ids.has(id)) continue;
        off();
        unsubscribes.delete(id);
        moved = id;
      }
      for (const id of ids) {
        if (unsubscribes.has(id)) continue;
        const off = await subscribe(id, heard);
        if (closed) {
          off();
          continue;
        }
        unsubscribes.set(id, off);
        moved = id;
      }
      return moved;
    },
    close() {
      closed = true;
      for (const off of unsubscribes.values()) off();
      unsubscribes.clear();
    },
  };
}
