import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { projectInvites, projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import {
  body,
  broadcast,
  clientIdOf,
  guard,
  json,
  adminOnly,
  route,
  str,
  signedInOnly,
} from "@/lib/api";
import { inviteMail, mailIsOn, sendMail } from "@/lib/mail";
import { originOf } from "@/lib/origin";
import { limiter, spendMail } from "@/lib/rate-limit";
import { projectName } from "@/lib/queries";
import { joinProject } from "@/lib/membership";
import { mintToken } from "@/lib/agents";
import { INVITE_DAYS, INVITE_MS, INVITE_PREFIX } from "@/lib/invite-link";
import { roleChangeRefusal } from "@/lib/roles";

type Ctx = { params: Promise<{ projectId: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user: actor, membership } = await guard(projectId);
  adminOnly(actor, membership, "add members");
  signedInOnly(actor);

  const input = await body<{ email?: string; role?: unknown }>(req);
  const email = str(input.email, "Email", { max: 200 }).toLowerCase();
  const role = input.role ?? "member";
  /* An invite makes somebody a member and then this role, so it asks the
     rule a role change asks, and says what that rule says. */
  const refusal = roleChangeRefusal({
    actor: membership.role,
    target: "member",
    targetKind: "human",
    next: String(role),
    self: false,
  });
  if (refusal) throw new HttpError(refusal.status, refusal.message);
  // The owner is handed over, never invited.
  if (role !== "member" && role !== "admin") {
    throw new HttpError(400, "An invite is for a member or an admin.");
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  /* No account yet: the invite is a link, sent to the email. Whoever opens
     it signs up with that email and is in, even through a closed sign-up.
     The email alone opens nothing: nobody has proved they own it. */
  if (!user) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, "That email address does not look correct.");
    }
    const minted = mintToken(INVITE_PREFIX);
    const now = new Date();
    /* A dead invite — old, or made before invites had links — takes the new
       link in its place; a live one is refused. One statement, so two admins
       inviting the same email at once cannot both get a link. */
    const [invite] = await db
      .insert(projectInvites)
      .values({
        projectId,
        email,
        invitedBy: actor.id,
        hash: minted.hash,
        expiresAt: new Date(now.getTime() + INVITE_MS),
        role,
      })
      .onConflictDoUpdate({
        target: [projectInvites.projectId, projectInvites.email],
        set: {
          invitedBy: actor.id,
          createdAt: now,
          hash: minted.hash,
          expiresAt: new Date(now.getTime() + INVITE_MS),
          role,
        },
        setWhere: or(isNull(projectInvites.hash), lte(projectInvites.expiresAt, now)),
      })
      .returning({
        email: projectInvites.email,
        createdAt: projectInvites.createdAt,
        role: projectInvites.role,
      });
    if (!invite) throw new HttpError(409, "That email is already invited.");
    await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });

    const link = `${originOf(req)}/invite/${minted.token}`;

    /* The invite is written before anything is sent, so a send that fails or
       hangs takes nothing back: the owner still has the link on screen. */
    const emailed =
      mailIsOn() &&
      spendMail(limiter, req.headers, actor.id) &&
      (await sendMail(
        inviteMail({
          to: invite.email,
          inviter: actor.name,
          project: await projectName(projectId),
          link,
          days: INVITE_DAYS,
        }),
      ));

    return json(
      {
        invite: {
          email: invite.email,
          createdAt: invite.createdAt.toISOString(),
          live: true,
          role: invite.role,
        },
        link,
        emailed,
      },
      201,
    );
  }

  const existing = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
    .limit(1);
  if (existing.length) throw new HttpError(409, "That person is already a member.");

  await db.transaction((tx) => joinProject(tx, { projectId, userId: user.id, role }));
  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json(
    {
      member: {
        id: user.id,
        name: user.name,
        email: user.email,
        color: user.color,
        emoji: user.avatarEmoji,
        role,
      },
      // Somebody with an account is in at once; nothing is emailed to them.
      emailed: false,
    },
    201,
  );
});
