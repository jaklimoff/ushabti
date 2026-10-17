import "server-only";
import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { personalTokens, users } from "@/db/schema";
import { hashToken, mintToken, PERSONAL_PREFIX } from "./agents";
import { HttpError } from "./auth";
import { isId, notAnId } from "./ids";
import type { PersonalTokenDTO } from "./types";

/** The expiries the account page offers, in days. Null never expires. */
export const PERSONAL_EXPIRIES = [30, 90, 365, null] as const;

export type PersonHolder = {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  tokenId: string;
  tokenName: string;
};

/** Looks a live personal token up. Null if it is unknown, revoked or expired. */
export async function personOfToken(token: string): Promise<PersonHolder | null> {
  const [row] = await db
    .select({
      tokenId: personalTokens.id,
      tokenName: personalTokens.name,
      id: users.id,
      name: users.name,
      color: users.color,
      emoji: users.avatarEmoji,
      kind: users.kind,
    })
    .from(personalTokens)
    .innerJoin(users, eq(users.id, personalTokens.userId))
    .where(
      and(
        eq(personalTokens.hash, hashToken(token)),
        isNull(personalTokens.revokedAt),
        or(isNull(personalTokens.expiresAt), gt(personalTokens.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (!row || row.kind !== "human") return null;
  await touch(row.tokenId);
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    emoji: row.emoji,
    tokenId: row.tokenId,
    tokenName: row.tokenName,
  };
}

/* "Last used" only has to be right to the minute, as for an agent token. */
const TOUCH_AFTER_MS = 60_000;

async function touch(tokenId: string): Promise<void> {
  const stale = new Date(Date.now() - TOUCH_AFTER_MS);
  try {
    await db
      .update(personalTokens)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(personalTokens.id, tokenId),
          or(isNull(personalTokens.lastUsedAt), lt(personalTokens.lastUsedAt, stale)),
        ),
      );
  } catch {
    // A missed timestamp must never fail the request that carried the token.
  }
}

function toDTO(row: typeof personalTokens.$inferSelect): PersonalTokenDTO {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** A person's tokens that still open something, newest first. */
export async function listPersonalTokens(userId: string): Promise<PersonalTokenDTO[]> {
  const rows = await db
    .select()
    .from(personalTokens)
    .where(
      and(
        eq(personalTokens.userId, userId),
        isNull(personalTokens.revokedAt),
        or(isNull(personalTokens.expiresAt), gt(personalTokens.expiresAt, new Date())),
      ),
    )
    .orderBy(desc(personalTokens.createdAt));
  return rows.map(toDTO);
}

/** Reads the expiry a form sent: one of `PERSONAL_EXPIRIES`, 90 when it sent none. */
export function readExpiry(value: unknown): number | null {
  if (value === undefined) return 90;
  if (value === null) return null;
  if ((PERSONAL_EXPIRIES as readonly (number | null)[]).includes(value as number)) {
    return value as number;
  }
  throw new HttpError(400, "A token expires in 30 days, 90 days, 1 year, or never.");
}

export async function makePersonalToken(
  userId: string,
  name: string,
  days: number | null,
): Promise<{ token: PersonalTokenDTO; secret: string }> {
  const minted = mintToken(PERSONAL_PREFIX);
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000);
  const [row] = await db
    .insert(personalTokens)
    .values({ userId, name, hash: minted.hash, prefix: minted.prefix, expiresAt })
    .returning();
  return { token: toDTO(row), secret: minted.token };
}

/** Revokes one of the person's own tokens. Somebody else's reads as not found. */
export async function revokePersonalToken(userId: string, tokenId: string): Promise<void> {
  if (!isId(tokenId)) throw new HttpError(400, notAnId("token"));
  const [row] = await db
    .update(personalTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(personalTokens.id, tokenId),
        eq(personalTokens.userId, userId),
        isNull(personalTokens.revokedAt),
      ),
    )
    .returning({ id: personalTokens.id });
  if (!row) throw new HttpError(404, "That token is gone already.");
}
