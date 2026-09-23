import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { adminOnly, guard, json, outranksOnly, readId, route } from "@/lib/api";
import { logActivity } from "@/lib/queries";
import { makeResetToken } from "@/lib/resets";

type Ctx = { params: Promise<{ projectId: string; userId: string }> };

/**
 * Makes a way back into a member's account. The answer carries the only copy
 * of the link: the table keeps a digest, so it is readable here and nowhere
 * again.
 *
 * `adminOnly` and then `outranksOnly` are the whole guard, and both are
 * `humanOnly` by construction: this hands out access to an account. An admin
 * may give it for a member, only the owner for an admin, and nobody for the
 * owner — least of all an agent that lost its token.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId, userId } = await ctx.params;
  const { user: actor, membership } = await guard(projectId);
  readId(userId, "member");
  adminOnly(actor, membership, "make a reset link for a member");

  if (userId === actor.id) {
    // They know their password, or they could not be reading this page.
    throw new HttpError(400, "Change your own password on your account page.");
  }

  const [member] = await db
    .select({ id: users.id, name: users.name, kind: users.kind, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  if (!member) throw new HttpError(404, "That person is not in this project.");
  if (member.kind === "agent") {
    throw new HttpError(400, "An agent has no password. Issue it a token instead.");
  }
  outranksOnly(actor, membership, member, "make a reset link for");

  const token = await makeResetToken(member.id, actor.id);

  /* The link row is swept as soon as it is spent or replaced, so the table
     forgets that anybody ever handed out access to this account. The feed
     is the record, and it keeps the name as well as the id: the `users` row
     may go, and the line still says who the link was for.

     No ring goes with it. Nothing on any screen changes, and a watcher reads
     the feed after its cursor, so the line reaches it on the next ring. */
  await logActivity({
    projectId,
    taskId: null,
    actorId: actor.id,
    kind: "reset",
    data: { forUserId: member.id, forName: member.name },
  });

  return json({ link: `${originOf(req)}/reset/${token}` }, 201);
});

/**
 * The address this board is reached at, as the browser that asked reached it.
 * The person who asked has to send this link to somebody, so it has to be the address
 * their team uses and not the one the container listens on.
 */
function originOf(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.slice(0, -1);
  return `${proto}://${host}`;
}
