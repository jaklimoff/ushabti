import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectInvites, projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, ownerOnly, route, str } from "@/lib/api";

type Ctx = { params: Promise<{ projectId: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user: actor, membership } = await guard(projectId);
  ownerOnly(actor, membership, "add members");

  const input = await body<{ email?: string }>(req);
  const email = str(input.email, "Email", { max: 200 }).toLowerCase();

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  /* No account yet: remember the email. The person joins when they sign up
     with it, and a closed sign-up lets them through for it. */
  if (!user) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, "That email address does not look correct.");
    }
    const invited = await db
      .select({ email: projectInvites.email })
      .from(projectInvites)
      .where(and(eq(projectInvites.projectId, projectId), eq(projectInvites.email, email)))
      .limit(1);
    if (invited.length) throw new HttpError(409, "That email is already invited.");
    const [invite] = await db
      .insert(projectInvites)
      .values({ projectId, email, invitedBy: actor.id })
      .returning({ email: projectInvites.email, createdAt: projectInvites.createdAt });
    await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
    return json(
      { invite: { email: invite.email, createdAt: invite.createdAt.toISOString() } },
      201,
    );
  }

  const existing = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
    .limit(1);
  if (existing.length) throw new HttpError(409, "That person is already a member.");

  await db.insert(projectMembers).values({ projectId, userId: user.id, role: "member" });
  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json(
    {
      member: {
        id: user.id,
        name: user.name,
        email: user.email,
        color: user.color,
        role: "member",
      },
    },
    201,
  );
});
