import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { projectInvites, projectMembers, projects } from "@/db/schema";
import { hashToken } from "./agents";
import { HttpError } from "./auth";
import { INVITE_IS_DEAD } from "./invite-link";
import { joinProject } from "./membership";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The invite this token opens now, or null. It writes nothing. */
export async function inviteOfToken(
  token: string,
  now = new Date(),
): Promise<{ projectId: string; email: string; project: string } | null> {
  const [invite] = await db
    .select({
      projectId: projectInvites.projectId,
      email: projectInvites.email,
      project: projects.name,
    })
    .from(projectInvites)
    .innerJoin(projects, eq(projects.id, projectInvites.projectId))
    .where(and(eq(projectInvites.hash, hashToken(token)), gt(projectInvites.expiresAt, now)))
    .limit(1);
  return invite ?? null;
}

/**
 * Spends the invite inside the sign-up's transaction, and answers its project
 * and the role it joins with, or null when the link is dead. The delete is the lock: two browsers on one
 * link leave one of them with nothing.
 */
export async function spendInvite(
  tx: Tx,
  token: string,
  email: string,
): Promise<{ projectId: string; role: string } | null> {
  const [spent] = await tx
    .delete(projectInvites)
    .where(
      and(
        eq(projectInvites.hash, hashToken(token)),
        eq(projectInvites.email, email),
        gt(projectInvites.expiresAt, new Date()),
      ),
    )
    .returning({ projectId: projectInvites.projectId, role: projectInvites.role });
  return spent ?? null;
}

/**
 * The sentence for an invite opened by an account with another email. It names
 * only the address the inviter typed, which the holder of the link already has.
 */
export function inviteIsForAnother(inviteEmail: string): string {
  return `This invite is for ${inviteEmail}. Sign in with that email to join.`;
}

/**
 * Lets an account that already exists in through its invite: the invite is
 * spent and the membership written in one transaction, so a link opened in
 * two tabs joins once. It answers the project, or throws the sentence the
 * page shows. Somebody already a member spends the invite and joins nothing
 * twice.
 */
export async function acceptInvite(
  token: string,
  user: { id: string; email: string },
): Promise<string> {
  const invite = await inviteOfToken(token);
  if (!invite) throw new HttpError(400, INVITE_IS_DEAD);
  if (invite.email !== user.email.toLowerCase()) {
    throw new HttpError(403, inviteIsForAnother(invite.email));
  }
  return db.transaction(async (tx) => {
    const spent = await spendInvite(tx, token, invite.email);
    if (!spent) throw new HttpError(400, INVITE_IS_DEAD);
    const [member] = await tx
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, spent.projectId), eq(projectMembers.userId, user.id)))
      .limit(1);
    /* Anything but admin joins as a member, so a stray word gives nothing. */
    const role = spent.role === "admin" ? "admin" : "member";
    if (!member) await joinProject(tx, { projectId: spent.projectId, userId: user.id, role });
    return spent.projectId;
  });
}
