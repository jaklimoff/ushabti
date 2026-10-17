import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import {
  body,
  broadcast,
  clientIdOf,
  adminOnly,
  guard,
  json,
  readId,
  route,
  str,
  signedInOnly,
} from "@/lib/api";
import { refuseTakenName, removeAgent } from "@/lib/agents";
import { logActivityIn } from "@/lib/activity";
import { readFace } from "@/lib/face";
import { withProjectLock, type Tx } from "@/lib/queries";
import { agentMay, canManage, isAgentAct, readAgentActs, type AgentAct } from "@/lib/roles";

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
 * The name, the colour and the emoji of an agent. It keeps the colour it was
 * given at random, so two agents, or an agent and a person, can wear the same
 * face. A person changes it and the agent does not: a face is how the team
 * tells who did the work, and a token that could change it could wear
 * somebody else's.
 *
 * A name is how a mention finds an agent, so two agents of one project may
 * not share one, whatever the case. History joins the name on read, so old
 * comments and runs show the new one; text already written keeps the old.
 *
 * `acts` switches acts off or on for this agent on this board alone. A switch
 * only takes away, so it is an admin's and a signed-in person's: a token that
 * could turn one on would give itself back what was taken.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { projectId, agentId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  readId(agentId, "agent");
  adminOnly(user, membership, "change an agent");
  signedInOnly(user);

  await agentOf(projectId, agentId);
  const input = await body<{ name?: unknown; color?: unknown; emoji?: unknown; acts?: unknown }>(
    req,
  );
  const acts = readActsInput(input.acts);
  const patch: { name?: string; color?: string; avatarEmoji?: string | null } = readFace(
    input,
    "the ◆",
  );
  if (input.name !== undefined) patch.name = str(input.name, "Name", { max: 80 });
  if (Object.keys(patch).length === 0 && acts.length === 0) return json({ ok: true });

  const { agent, ring } = await withProjectLock(projectId, async (tx) => {
    if (patch.name !== undefined) await refuseTakenName(tx, projectId, patch.name, agentId);
    const [row] =
      Object.keys(patch).length > 0
        ? await tx.update(users).set(patch).where(eq(users.id, agentId)).returning({
            id: users.id,
            name: users.name,
            color: users.color,
            emoji: users.avatarEmoji,
          })
        : await tx
            .select({
              id: users.id,
              name: users.name,
              color: users.color,
              emoji: users.avatarEmoji,
            })
            .from(users)
            .where(eq(users.id, agentId));
    return { agent: row, ring: await writeActs(tx, projectId, row, user.id, acts) };
  });
  await ring();

  /* A watcher matches mentions against its name, so the event names the
     agent and that watcher reads the name again. */
  await broadcast({
    projectId,
    scope: "project",
    clientId: clientIdOf(req),
    ...(patch.name !== undefined ? { renamed: agentId } : {}),
  });
  return json({ agent });
});

/** `{ act: on }`, each act one the code knows and each value on or off. */
function readActsInput(value: unknown): [AgentAct, boolean][] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "The acts are an object of act and on or off.");
  }
  return Object.entries(value).map(([act, on]) => {
    if (!isAgentAct(act)) throw new HttpError(400, `There is no act called ${act}.`);
    if (typeof on !== "boolean") throw new HttpError(400, "An act is on or off.");
    return [act, on];
  });
}

/**
 * The switches, read again under the project lock, as a role change is. Only
 * an act that changes is written, and each writes one line on the project,
 * so the feed says who let the agent do what, and when.
 */
async function writeActs(
  tx: Tx,
  projectId: string,
  agent: { id: string; name: string },
  actorId: string,
  changes: [AgentAct, boolean][],
) {
  if (changes.length === 0) return async () => {};
  const [actor] = await tx
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorId)));
  if (!actor || !canManage(actor.role)) {
    throw new HttpError(403, "Only the owner or an admin can change an agent.");
  }
  const [row] = await tx
    .select({ acts: projectMembers.acts })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, agent.id)));
  const acts = readAgentActs(row?.acts);
  const changed = changes.filter(([act, on]) => agentMay(acts, act) !== on);
  if (changed.length === 0) return async () => {};
  for (const [act, on] of changed) acts[act] = on;
  await tx
    .update(projectMembers)
    .set({ acts })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, agent.id)));
  return logActivityIn(
    tx,
    changed.map(([act, on]) => ({
      projectId,
      taskId: null,
      actorId,
      kind: "may",
      data: { agentId: agent.id, agentName: agent.name, act, on },
    })),
  );
}

/**
 * Removes the agent from the project, as a person is removed: its membership
 * and its tokens go, and its user row stays. The runs it made, with their
 * plans and their logs, hang off that row, and so do the names on its comments
 * and its activity. Deleting the row took every run with it.
 */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const { projectId, agentId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  readId(agentId, "agent");
  adminOnly(user, membership, "remove an agent");
  signedInOnly(user);

  await agentOf(projectId, agentId);

  await withProjectLock(projectId, (tx) => removeAgent(tx, projectId, agentId));
  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json({ ok: true });
});
