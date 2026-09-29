import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { adminOnly, guard, json, outranksOnly, readId, route } from "@/lib/api";
import { mailIsOn, resetMail, sendMail } from "@/lib/mail";
import { originOf } from "@/lib/origin";
import { limiter, spendMail } from "@/lib/rate-limit";
import { logActivity, projectName } from "@/lib/queries";
import { RESET_HOURS } from "@/lib/reset-link";
import { makeResetToken } from "@/lib/resets";

type Ctx = { params: Promise<{ projectId: string; userId: string }> };

/**
 * Makes a way back into a member's account. The answer carries the only copy
 * of the link: the table keeps a digest, so it is readable here and nowhere
 * again — except in the one email sent to the member, when mail is on.
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
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      kind: users.kind,
      role: projectMembers.role,
    })
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

  const link = `${originOf(req)}/reset/${token}`;

  /* The link is written and the feed says so before anything is sent, so a
     send that fails or hangs takes nothing back. The link is answered either
     way: an email can still be lost. */
  const emailed =
    mailIsOn() &&
    member.email !== null &&
    spendMail(limiter, req.headers, actor.id) &&
    (await sendMail(
      resetMail({
        to: member.email,
        name: member.name,
        maker: actor.name,
        project: await projectName(projectId),
        link,
        hours: RESET_HOURS,
      }),
    ));

  return json({ link, emailed }, 201);
});
