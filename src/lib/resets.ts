import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { passwordResets, sessions, users } from "@/db/schema";
import { hashToken, mintToken } from "./agents";
import { hashPassword } from "./auth";
import { lifeOfLink, RESET_MS } from "./reset-link";

/**
 * Makes a link for one account and answers the only copy of its token. The
 * table keeps the digest, so nobody — the owner included — reads it again.
 *
 * Nothing older is touched: `lifeOfLink` calls an older link superseded when
 * it is read, which is one decision in one place instead of a write that can
 * be lost.
 */
export async function makeResetToken(userId: string, madeBy: string): Promise<string> {
  const minted = mintToken();
  await db.insert(passwordResets).values({
    userId,
    hash: minted.hash,
    madeBy,
    expiresAt: new Date(Date.now() + RESET_MS),
  });
  return minted.token;
}

/** The account this token opens now, or null. It writes nothing. */
export async function accountOfToken(token: string, now = new Date()): Promise<string | null> {
  const [link] = await db
    .select({
      userId: passwordResets.userId,
      createdAt: passwordResets.createdAt,
      expiresAt: passwordResets.expiresAt,
      usedAt: passwordResets.usedAt,
    })
    .from(passwordResets)
    .where(eq(passwordResets.hash, hashToken(token)))
    .limit(1);
  if (!link) return null;

  const [newest] = await db
    .select({ createdAt: passwordResets.createdAt })
    .from(passwordResets)
    .where(eq(passwordResets.userId, link.userId))
    .orderBy(desc(passwordResets.createdAt))
    .limit(1);

  return lifeOfLink(link, newest?.createdAt ?? link.createdAt, now) === "live" ? link.userId : null;
}

/**
 * Spends the link and sets the password. It answers the account, or null when
 * the link is dead.
 *
 * The spend is the lock: one update takes the row that has no `used_at` yet,
 * so two browsers opening the same link at once leave one of them with
 * nothing. Every session of the account then ends — whoever knew the old
 * password is signed out — and the caller signs this browser in.
 */
export async function useResetToken(token: string, password: string): Promise<string | null> {
  const userId = await accountOfToken(token);
  if (!userId) return null;

  const spent = await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.hash, hashToken(token)), isNull(passwordResets.usedAt)))
    .returning({ userId: passwordResets.userId });
  if (!spent.length) return null;

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));

  return userId;
}
