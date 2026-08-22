import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, humanOnly, json, route } from "@/lib/api";

type Ctx = { params: Promise<{ projectId: string; agentId: string }> };

/**
 * Deletes the agent. An agent belongs to one project, so this removes the
 * machine member for good, with its tokens, its runs and its authorship.
 */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const { projectId, agentId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  humanOnly(user);
  if (membership.role !== "owner") throw new HttpError(403, "Only the owner can remove an agent.");

  const [row] = await db
    .select({ id: users.id, kind: users.kind })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, agentId)))
    .limit(1);

  if (!row) throw new HttpError(404, "That agent is not in this project.");
  if (row.kind !== "agent") throw new HttpError(400, "That member is a person, not an agent.");

  const open = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, agentId), isNull(agentRuns.endedAt)))
    .limit(1);
  if (open.length) {
    throw new HttpError(409, "That agent still holds a task. Take the task over first.");
  }

  await db.delete(users).where(eq(users.id, agentId));
  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json({ ok: true });
});
