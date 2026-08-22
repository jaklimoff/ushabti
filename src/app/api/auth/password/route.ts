import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { currentSessionId, hashPassword, HttpError, requireUser, verifyPassword } from "@/lib/auth";
import { body, json, route } from "@/lib/api";

/**
 * There is no password reset, so this is the only way back from a password you
 * think has leaked. Every other session ends with the change: whoever knew the
 * old one is signed out.
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

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.next) })
    .where(eq(users.id, user.id));

  const keep = await currentSessionId();
  await db
    .delete(sessions)
    .where(
      keep
        ? and(eq(sessions.userId, user.id), ne(sessions.id, keep))
        : eq(sessions.userId, user.id),
    );

  return json({ ok: true });
});
