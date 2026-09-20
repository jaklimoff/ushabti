import "server-only";
import { and, desc, eq, gt, isNull, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { passwordResets, sessions, users } from "@/db/schema";
import { hashToken, mintToken } from "./agents";
import { hashPassword } from "./auth";
import { lifeOfLink, RESET_MS, RESET_PREFIX } from "./reset-link";

/** The same table again, so one row can ask whether a later one exists. */
const newer = alias(passwordResets, "newer");

/**
 * Makes a link for one account and answers the only copy of its token. The
 * table keeps the digest, so nobody — the owner included — reads it again.
 *
 * Nothing older is touched: `lifeOfLink` calls an older link superseded when
 * it is read, which is one decision in one place instead of a write that can
 * be lost.
 */
export async function makeResetToken(userId: string, madeBy: string): Promise<string> {
  const minted = mintToken(RESET_PREFIX);
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
 * The spend is the lock, and it asks the whole rule rather than part of it:
 * one update takes the row that is unused, still inside its day, and still the
 * newest for that person. Two browsers on the same link leave one of them with
 * nothing, and nothing can slip through between the read and the write.
 *
 * All three writes are one transaction. A hash that throws, or a database that
 * goes away between them, would otherwise burn the link and leave the old
 * password in place — the one failure this whole feature exists to prevent.
 */
export async function useResetToken(token: string, password: string): Promise<string | null> {
  const hash = hashToken(token);
  // scrypt is slow on purpose, so it runs before the transaction opens rather
  // than holding a row lock for the length of it.
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const spent = await tx
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResets.hash, hash),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, new Date()),
          // Superseded: any newer link for the same person takes this one's
          // place. The same question `lifeOfLink` asks, asked in SQL so that
          // the lock and the rule cannot disagree.
          notExists(
            tx
              .select({ one: sql`1` })
              .from(newer)
              .where(
                and(
                  eq(newer.userId, passwordResets.userId),
                  gt(newer.createdAt, passwordResets.createdAt),
                ),
              ),
          ),
        ),
      )
      .returning({ userId: passwordResets.userId });

    const userId = spent[0]?.userId;
    if (!userId) return null;

    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    // Every session, including any this browser held: the caller opens a new
    // one, and whoever knew the old password is signed out.
    await tx.delete(sessions).where(eq(sessions.userId, userId));

    return userId;
  });
}
