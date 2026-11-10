import "server-only";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { agentTokens, personalTokens, projectMembers, sessions } from "@/db/schema";
import { currentSessionId, type Actor } from "./auth";

/**
 * What let a stream in, kept by id. A stream outlives the request that
 * opened it, so it cannot read the cookie or the header again; it asks the
 * database whether the same session or token still opens the door.
 */
export type Holder = {
  userId: string;
  sessionId: string | null;
  agentTokenId: string | null;
  personalTokenId: string | null;
};

/** Called while the request is still here, right after the guard. */
export async function holderOf(actor: Actor): Promise<Holder> {
  const token = actor.tokenId ?? actor.personalTokenId ?? null;
  return {
    userId: actor.id,
    sessionId: token ? null : await currentSessionId(),
    agentTokenId: actor.tokenId ?? null,
    personalTokenId: actor.personalTokenId ?? null,
  };
}

/**
 * Whether the session or token that opened a stream still holds, and, with a
 * project, whether its holder is still a member. A stream asks on every ping
 * and closes on a no, so a removed member or a revoked token stops hearing
 * rings and presence within one.
 */
export async function stillAllowed(holder: Holder, projectId?: string): Promise<boolean> {
  const now = new Date();
  let held: unknown[];
  if (holder.agentTokenId) {
    held = await db
      .select({ id: agentTokens.id })
      .from(agentTokens)
      .where(
        and(
          eq(agentTokens.id, holder.agentTokenId),
          eq(agentTokens.agentId, holder.userId),
          isNull(agentTokens.revokedAt),
        ),
      )
      .limit(1);
  } else if (holder.personalTokenId) {
    held = await db
      .select({ id: personalTokens.id })
      .from(personalTokens)
      .where(
        and(
          eq(personalTokens.id, holder.personalTokenId),
          eq(personalTokens.userId, holder.userId),
          isNull(personalTokens.revokedAt),
          or(isNull(personalTokens.expiresAt), gt(personalTokens.expiresAt, now)),
        ),
      )
      .limit(1);
  } else if (holder.sessionId) {
    held = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, holder.sessionId),
          eq(sessions.userId, holder.userId),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);
  } else {
    return false;
  }
  if (held.length === 0) return false;
  if (!projectId) return true;
  const member = await db
    .select({ id: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, holder.userId)))
    .limit(1);
  return member.length > 0;
}
