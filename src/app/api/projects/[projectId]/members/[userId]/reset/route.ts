import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { adminOnly, guard, json, outranksOnly, readId, route, signedInOnly } from "@/lib/api";
import { mailIsOn, resetMail, sendMail } from "@/lib/mail";
import { originOf } from "@/lib/origin";
import { limiter, spendMail } from "@/lib/rate-limit";
import { logActivity, projectName } from "@/lib/queries";
import { RESET_HOURS } from "@/lib/reset-link";
import { makeResetToken } from "@/lib/resets";
import { outranksEverywhere } from "@/lib/roles";

/** The actor's own membership, beside each of the member's. */
const mine = alias(projectMembers, "mine");

type Ctx = { params: Promise<{ projectId: string; userId: string }> };

/**
 * Makes a way back into a member's account. With mail on, the link goes to
 * the member's own address and never into the answer, which says only
 * whether it was sent. With mail off, the answer carries the only copy, and
 * only to somebody who outranks the member in every project the member is in:
 * the link opens the whole account, not this project. The table keeps a
 * digest, so the link is readable nowhere else.
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
  signedInOnly(actor);

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

  const mailOn = mailIsOn();
  if (!mailOn) {
    const places = await db
      .select({ target: projectMembers.role, actor: mine.role })
      .from(projectMembers)
      .leftJoin(mine, and(eq(mine.projectId, projectMembers.projectId), eq(mine.userId, actor.id)))
      .where(eq(projectMembers.userId, member.id));
    if (!outranksEverywhere(places)) {
      throw new HttpError(
        403,
        `${member.name} is also in a project you do not run. Their reset link can go only to their own email, and this server sends no mail.`,
      );
    }
  }

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

  if (!mailOn) return json({ link, emailed: false }, 201);

  /* The link is written and the feed says so before anything is sent, so a
     send that fails or hangs takes nothing back. It is never answered: the
     mailbox is the member's, and the answer goes to somebody else. */
  const emailed =
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

  return json({ emailed }, 201);
});
