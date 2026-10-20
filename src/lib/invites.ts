import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { projectInvites, projects } from "@/db/schema";
import { hashToken } from "./agents";

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
