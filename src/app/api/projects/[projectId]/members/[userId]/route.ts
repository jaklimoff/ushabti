import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, humanOnly, json, route } from "@/lib/api";

type Ctx = { params: Promise<{ projectId: string; userId: string }> };

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { projectId, userId } = await ctx.params;
  const { user, membership } = await guard(projectId);

  const removingSelf = user.id === userId;
  // A person may leave. An agent may not: the owner removes it in Settings,
  // which deletes its user row and its tokens with it.
  if (removingSelf && user.kind === "agent") {
    throw new HttpError(403, "An agent cannot leave a project. Ask the owner to remove it.");
  }
  if (!removingSelf) {
    humanOnly(user);
    if (membership.role !== "owner") {
      throw new HttpError(403, "Only the owner can remove members.");
    }
  }
  if (userId === membership.ownerId) {
    throw new HttpError(400, "The owner cannot leave the project. Delete the project instead.");
  }

  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json({ ok: true });
});
