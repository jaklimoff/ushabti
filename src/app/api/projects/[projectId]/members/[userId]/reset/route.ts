import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { guard, json, ownerOnly, route } from "@/lib/api";
import { makeResetToken } from "@/lib/resets";

type Ctx = { params: Promise<{ projectId: string; userId: string }> };

/**
 * Makes a way back into a member's account. The answer carries the only copy
 * of the link: the table keeps a digest, so it is readable here and nowhere
 * again.
 *
 * `ownerOnly` is the whole guard, and it is `humanOnly` by construction: this
 * hands out access to an account, which is the owner's to give and nobody
 * else's — least of all an agent that lost its token.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId, userId } = await ctx.params;
  const { user: actor, membership } = await guard(projectId);
  ownerOnly(actor, membership, "make a reset link");

  if (userId === actor.id) {
    // The owner knows their password, or they could not be reading this page.
    throw new HttpError(400, "Change your own password on your account page.");
  }

  const [member] = await db
    .select({ id: users.id, kind: users.kind })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  if (!member) throw new HttpError(404, "That person is not in this project.");
  if (member.kind === "agent") {
    throw new HttpError(400, "An agent has no password. Issue it a token instead.");
  }

  const token = await makeResetToken(member.id, actor.id);
  return json({ link: `${originOf(req)}/reset/${token}` }, 201);
});

/**
 * The address this board is reached at, as the browser that asked reached it.
 * The owner has to send this link to somebody, so it has to be the address
 * their team uses and not the one the container listens on.
 */
function originOf(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.slice(0, -1);
  return `${proto}://${host}`;
}
