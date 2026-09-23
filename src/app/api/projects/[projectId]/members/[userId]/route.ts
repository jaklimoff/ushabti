import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import {
  body,
  broadcast,
  clientIdOf,
  guard,
  humanOnly,
  json,
  outranksOnly,
  readId,
  roleChangeOnly,
  route,
} from "@/lib/api";
import { withProjectLock, type Tx } from "@/lib/queries";
import { isOwner } from "@/lib/roles";

type Ctx = { params: Promise<{ projectId: string; userId: string }> };

async function memberOf(tx: Tx | typeof db, projectId: string, userId: string) {
  const [row] = await tx
    .select({ role: projectMembers.role, kind: users.kind })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { projectId, userId } = await ctx.params;
  const { user } = await guard(projectId);
  readId(userId, "member");

  const removingSelf = user.id === userId;
  // A person may leave. An agent may not: an admin removes it in Settings,
  // which deletes its user row and its tokens with it.
  if (removingSelf && user.kind === "agent") {
    throw new HttpError(
      403,
      "An agent cannot leave a project. Ask the owner or an admin to remove it.",
    );
  }
  if (!removingSelf) humanOnly(user);

  /* Under the project lock, and with both roles read again inside it. A
     hand-over commits under the same lock, so the owner this reads is the
     owner now: without it, a person who leaves while the project is handed
     to them leaves a project whose owner is not a member. */
  await withProjectLock(projectId, async (tx) => {
    const target = await memberOf(tx, projectId, userId);
    if (!target) throw new HttpError(404, "That person is not in this project.");
    if (removingSelf && isOwner(target.role)) {
      throw new HttpError(400, "The owner cannot leave the project. Delete the project instead.");
    }
    if (!removingSelf) {
      const actor = await memberOf(tx, projectId, user.id);
      if (!actor) throw new HttpError(404, "Project not found.");
      outranksOnly(user, actor, target, "remove");
    }
    await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  });
  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json({ ok: true });
});

/**
 * Changes a person's role. Making somebody the owner hands the project over:
 * the old owner becomes an admin in the same transaction, so a project always
 * has exactly one owner. Both roles are read again under the project lock, so
 * two hand-overs at the same moment cannot leave two owners behind.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { projectId, userId } = await ctx.params;
  const { user } = await guard(projectId);
  humanOnly(user);
  readId(userId, "member");
  const input = await body<{ role?: unknown }>(req);
  const next = typeof input.role === "string" ? input.role : "";

  const changed = await withProjectLock(projectId, async (tx) => {
    const actor = await memberOf(tx, projectId, user.id);
    const target = await memberOf(tx, projectId, userId);
    if (!actor || !target) throw new HttpError(404, "That person is not in this project.");
    roleChangeOnly(user, {
      actor: actor.role,
      target: target.role,
      targetKind: target.kind === "agent" ? "agent" : "human",
      next,
      self: user.id === userId,
    });
    if (next === target.role) return false;

    if (next === "owner") {
      await tx.update(projects).set({ ownerId: userId }).where(eq(projects.id, projectId));
      await tx
        .update(projectMembers)
        .set({ role: "admin" })
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)));
    }
    const updated = await tx
      .update(projectMembers)
      .set({ role: next })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .returning({ userId: projectMembers.userId });
    // Throwing rolls the hand-over back with it, so the project keeps its owner.
    if (updated.length === 0) throw new HttpError(404, "That person is not in this project.");
    return true;
  });

  if (changed) await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json({ ok: true });
});
