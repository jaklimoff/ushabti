import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { currentSessionId, hashPassword, HttpError, requireUser, verifyPassword } from "@/lib/auth";
import { body, json, route } from "@/lib/api";
import { revokeAllPersonalTokens } from "@/lib/personal-tokens";

/**
 * The way back from a password you think has leaked, and still know. Every
 * other session and every personal token ends with the change: whoever knew
 * the old one is signed out.
 * A password nobody knows is the reset link's job, not this route's.
 */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const input = await body<{ current?: string; next?: string }>(req);

  if (typeof input.current !== "string" || typeof input.next !== "string") {
    throw new HttpError(400, "Send the password you use now and the one you want.");
  }
  if (input.next.length < 8) {
    throw new HttpError(400, "The new password must have at least 8 characters.");
  }

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row?.passwordHash) throw new HttpError(400, "This account has no password.");
  if (!(await verifyPassword(input.current, row.passwordHash))) {
    throw new HttpError(403, "That is not the password you use now.");
  }

  const passwordHash = await hashPassword(input.next);
  const keep = await currentSessionId();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await tx
      .delete(sessions)
      .where(
        keep
          ? and(eq(sessions.userId, user.id), ne(sessions.id, keep))
          : eq(sessions.userId, user.id),
      );
    // A token made by whoever knew the old password would outlive it.
    await revokeAllPersonalTokens(user.id, tx);
  });

  return json({ ok: true });
});
