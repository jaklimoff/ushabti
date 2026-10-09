import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers } from "@/db/schema";
import { body, guard, humanOnly, json, readId, route } from "@/lib/api";
import { lockList } from "@/lib/membership";
import { byPos } from "@/lib/order";
import { rankBetween } from "@/lib/rank";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Moves a project in the caller's own list. A drag names the project it
 * landed after, null for the top, never a rank: the rank is worked out here
 * from this person's memberships alone, so nobody else's list moves. It
 * broadcasts nothing, because no board changed.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);
  // An agent's list is nobody's screen.
  humanOnly(user);

  const input = await body<{ afterId?: string | null }>(req);
  const afterId = input.afterId ? readId(input.afterId, "project") : null;

  await db.transaction(async (tx) => {
    await lockList(tx, user.id);
    const siblings = await tx
      .select({ id: projectMembers.projectId, position: projectMembers.position })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, user.id), ne(projectMembers.projectId, projectId)))
      .orderBy(byPos(projectMembers.position));
    const index = afterId ? siblings.findIndex((s) => s.id === afterId) : -1;
    const before = index >= 0 ? siblings[index].position : null;
    const after = siblings[index + 1]?.position ?? null;
    await tx
      .update(projectMembers)
      .set({ position: rankBetween(before, after) })
      .where(and(eq(projectMembers.userId, user.id), eq(projectMembers.projectId, projectId)));
  });
  return json({ ok: true });
});
