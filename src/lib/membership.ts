import { eq, sql } from "drizzle-orm";
/* Relative, so the seed script, which runs outside Next, reaches the same pool. */
import { db } from "../db";
import { projectMembers, users } from "../db/schema";
import { byPos } from "./order";
import { rankBetween } from "./rank";

type Writer = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Takes this person's list for the rest of the transaction. Their order is
 * theirs alone, so the lock is their user row and never a project: a join and
 * a drag of the same person cannot both read the same top.
 */
export async function lockList(tx: Writer, userId: string) {
  await tx.execute(sql`select 1 from ${users} where ${users.id} = ${userId} for update`);
}

/**
 * Puts somebody on a project, at the top of their own list. Every membership
 * is written here, so a project a person makes, is added to or comes back to
 * is the first one they see. Call it inside a transaction: the lock it takes
 * lasts until that ends.
 */
export async function joinProject(
  tx: Writer,
  member: { projectId: string; userId: string; role: string },
) {
  await lockList(tx, member.userId);
  const [first] = await tx
    .select({ position: projectMembers.position })
    .from(projectMembers)
    .where(eq(projectMembers.userId, member.userId))
    .orderBy(byPos(projectMembers.position))
    .limit(1);
  await tx.insert(projectMembers).values({
    ...member,
    position: rankBetween(null, first?.position ?? null),
  });
}
