import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectInvites, projectMembers, users } from "@/db/schema";
import { createSession, hashPassword, HttpError, refuseIfLimited, signupIsOpen } from "@/lib/auth";
import { body, broadcast, json, route, str } from "@/lib/api";
import { pickAvatarColor } from "@/lib/colors";
import { addressOf, limiter, signupByAddress } from "@/lib/rate-limit";

export const POST = route(async (req: Request) => {
  const key = signupByAddress(addressOf(req.headers));
  refuseIfLimited(key);
  try {
    return await signUp(req);
  } catch (err) {
    /* Only a refused sign-up counts. A team all joining on their first
       morning from one office address must never lock the rest out. */
    if (err instanceof HttpError) limiter.hit(key);
    throw err;
  }
});

async function signUp(req: Request): Promise<Response> {
  const input = await body<{ email?: string; password?: string; name?: string }>(req);

  const email = str(input.email, "Email", { max: 200 }).toLowerCase();
  const name = str(input.name, "Name", { max: 80 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "That email address does not look correct.");
  }

  /* An invited email gets in through a closed board: the owner asked for
     this person, which is what "closed" is there to protect. */
  const invites = await db
    .select({ projectId: projectInvites.projectId })
    .from(projectInvites)
    .where(eq(projectInvites.email, email));
  if (!signupIsOpen() && invites.length === 0) {
    throw new HttpError(
      403,
      "This board is not taking new accounts. Ask the owner of your project to invite this email.",
    );
  }
  if (typeof input.password !== "string" || input.password.length < 8) {
    throw new HttpError(400, "The password must have at least 8 characters.");
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length) throw new HttpError(409, "An account with that email already exists.");

  const passwordHash = await hashPassword(input.password);

  /* One transaction, so a failure leaves no account without its projects.
     The memberships come from the invites the delete took, never from the
     read above: an invite that lands in between still gets its member. */
  const { user, joined } = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email, name, passwordHash, color: pickAvatarColor(email) })
      .returning({ id: users.id, email: users.email, name: users.name, color: users.color });
    const joined = await tx
      .delete(projectInvites)
      .where(eq(projectInvites.email, email))
      .returning({ projectId: projectInvites.projectId });
    if (joined.length) {
      await tx
        .insert(projectMembers)
        .values(joined.map((i) => ({ projectId: i.projectId, userId: user.id, role: "member" })));
    }
    return { user, joined };
  });

  for (const invite of joined) {
    await broadcast({ projectId: invite.projectId, scope: "project" });
  }

  await createSession(user.id);
  return json({ user });
}
