import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectInvites } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, json, ownerOnly, route } from "@/lib/api";

type Ctx = { params: Promise<{ projectId: string; email: string }> };

/** Withdraws an invite. The email can no longer sign up through a closed board. */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const { projectId, email: raw } = await ctx.params;
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "withdraw an invite");

  const email = decodeURIComponent(raw).toLowerCase();
  const gone = await db
    .delete(projectInvites)
    .where(and(eq(projectInvites.projectId, projectId), eq(projectInvites.email, email)))
    .returning({ email: projectInvites.email });
  if (!gone.length) throw new HttpError(404, "No invite uses that email.");

  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json({ ok: true });
});
