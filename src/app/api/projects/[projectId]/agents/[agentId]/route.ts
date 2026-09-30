import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, adminOnly, guard, json, readId, route } from "@/lib/api";
import { readFace } from "@/lib/face";

type Ctx = { params: Promise<{ projectId: string; agentId: string }> };

/** The agent, if it is a member of this project; a person here is refused. */
async function agentOf(projectId: string, agentId: string) {
  const [row] = await db
    .select({ id: users.id, kind: users.kind })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, agentId)))
    .limit(1);

  if (!row) throw new HttpError(404, "That agent is not in this project.");
  if (row.kind !== "agent") throw new HttpError(400, "That member is a person, not an agent.");
  return row;
}

/**
 * The colour and the emoji of an agent. It keeps the colour it was given at
 * random, so two agents, or an agent and a person, can wear the same face. A
 * person changes it and the agent does not: a face is how the team tells who
 * did the work, and a token that could change it could wear somebody else's.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { projectId, agentId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  readId(agentId, "agent");
  adminOnly(user, membership, "change an agent");

  await agentOf(projectId, agentId);
  const patch = readFace(await body<{ color?: unknown; emoji?: unknown }>(req), "the ◆");
  if (Object.keys(patch).length === 0) return json({ ok: true });

  const [agent] = await db.update(users).set(patch).where(eq(users.id, agentId)).returning({
    id: users.id,
    name: users.name,
    color: users.color,
    emoji: users.avatarEmoji,
  });

  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json({ agent });
});

/**
 * Deletes the agent. An agent belongs to one project, so this removes the
 * machine member for good, with its tokens, its runs and its authorship.
 */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const { projectId, agentId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  readId(agentId, "agent");
  adminOnly(user, membership, "remove an agent");

  await agentOf(projectId, agentId);

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
