import { and, count, eq, gt, ne } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { currentSessionId, requireUser } from "@/lib/auth";
import { json, route } from "@/lib/api";

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

/** Ends every session except this one. */
export const DELETE = route(async () => {
  const user = await requireUser();
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
