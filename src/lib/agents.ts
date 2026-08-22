import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { agentTokens, projectMembers, users } from "@/db/schema";
import type { AgentDTO } from "./types";

/** Every token starts with this, so a leak is easy to search for. */
export const TOKEN_PREFIX = "ush_";

/** How much of the token the list shows. Enough to tell two of them apart. */
const VISIBLE = TOKEN_PREFIX.length + 8;

export type MintedToken = { token: string; hash: string; prefix: string };

export function mintToken(): MintedToken {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token), prefix: token.slice(0, VISIBLE) };
}

/**
 * A token is high entropy random, so one round of SHA-256 is right here. A
 * password needs scrypt because a person picks it; this nobody guesses.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Reads the token out of an Authorization header. Null if there is none. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  return token;
}

export type TokenHolder = {
  id: string;
  name: string;
  color: string;
  /** The one project this token opens. */
  projectId: string;
  tokenId: string;
};

/** Looks a live token up. Null if it is unknown, revoked, or not an agent. */
export async function holderOfToken(token: string): Promise<TokenHolder | null> {
  const [row] = await db
    .select({
      tokenId: agentTokens.id,
      projectId: agentTokens.projectId,
      lastUsedAt: agentTokens.lastUsedAt,
      id: users.id,
      name: users.name,
      color: users.color,
      kind: users.kind,
    })
    .from(agentTokens)
    .innerJoin(users, eq(users.id, agentTokens.agentId))
    .where(and(eq(agentTokens.hash, hashToken(token)), isNull(agentTokens.revokedAt)))
    .limit(1);

  if (!row || row.kind !== "agent") return null;
  await touch(row.tokenId);
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    projectId: row.projectId,
    tokenId: row.tokenId,
  };
}

/**
 * "Last used" only has to be right to the minute. Writing it on every call
 * would put one extra write in front of every agent request.
 */
const TOUCH_AFTER_MS = 60_000;

async function touch(tokenId: string): Promise<void> {
  const stale = new Date(Date.now() - TOUCH_AFTER_MS);
  try {
    await db
      .update(agentTokens)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(agentTokens.id, tokenId),
          or(isNull(agentTokens.lastUsedAt), lt(agentTokens.lastUsedAt, stale)),
        ),
      );
  } catch {
    // A missed timestamp must never fail the request that carried the token.
  }
}

/** Every agent of a project, with the tokens that are still live. */
export async function loadAgents(projectId: string): Promise<AgentDTO[]> {
  const [rows, tokenRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        color: users.color,
        createdAt: users.createdAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(and(eq(projectMembers.projectId, projectId), eq(users.kind, "agent")))
      .orderBy(asc(users.name)),
    db
      .select({
        id: agentTokens.id,
        agentId: agentTokens.agentId,
        name: agentTokens.name,
        prefix: agentTokens.prefix,
        createdAt: agentTokens.createdAt,
        lastUsedAt: agentTokens.lastUsedAt,
      })
      .from(agentTokens)
      .where(and(eq(agentTokens.projectId, projectId), isNull(agentTokens.revokedAt)))
      .orderBy(asc(agentTokens.createdAt)),
  ]);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
    tokens: tokenRows
      .filter((t) => t.agentId === row.id)
      .map((t) => ({
        id: t.id,
        name: t.name,
        prefix: t.prefix,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      })),
  }));
}
