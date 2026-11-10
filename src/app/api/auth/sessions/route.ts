import { and, count, eq, gt, ne } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { currentSessionId, requireUser } from "@/lib/auth";
import { json, route } from "@/lib/api";
import { revokeAllPersonalTokens } from "@/lib/personal-tokens";

/** How many other browsers hold a live session for this account. */
export const GET = route(async () => {
  const user = await requireUser();
  const keep = await currentSessionId();
  const [row] = await db
    .select({ n: count() })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, user.id),
        gt(sessions.expiresAt, new Date()),
        ...(keep ? [ne(sessions.id, keep)] : []),
      ),
    );
  return json({ others: row?.n ?? 0 });
});

/**
 * Ends every session except this one, and every personal token: somebody who
 * signs out everywhere fears another holds the account, and a token is a way
 * in that no session list shows.
 */
export const DELETE = route(async () => {
  const user = await requireUser();
  const keep = await currentSessionId();
  await db.transaction(async (tx) => {
    await tx
      .delete(sessions)
      .where(
        keep
          ? and(eq(sessions.userId, user.id), ne(sessions.id, keep))
          : eq(sessions.userId, user.id),
      );
    await revokeAllPersonalTokens(user.id, tx);
  });
  return json({ ok: true });
});
