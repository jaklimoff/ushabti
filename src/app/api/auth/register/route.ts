import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { INVITE_IS_DEAD } from "@/lib/invite-link";
import { inviteOfToken, spendInvite } from "@/lib/invites";
import { joinProject } from "@/lib/membership";
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
  const input = await body<{ email?: string; password?: string; name?: string; invite?: string }>(
    req,
  );

  const email = str(input.email, "Email", { max: 200 }).toLowerCase();
  const name = str(input.name, "Name", { max: 80 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "That email address does not look correct.");
  }

  /* Only the link opens a project, and a closed board. An invited email on
     its own proves nothing: nothing here checks that somebody owns an
     address, so a stranger who typed it would be in before the real person. */
  const token = typeof input.invite === "string" && input.invite ? input.invite : null;
  if (token) {
    const invite = await inviteOfToken(token);
    if (!invite) throw new HttpError(400, INVITE_IS_DEAD);
    if (invite.email !== email) {
      throw new HttpError(400, `This invite is for ${invite.email}. Sign up with that email.`);
    }
  } else if (!signupIsOpen()) {
    throw new HttpError(
      403,
      "This board is not taking new accounts. Ask the owner of your project to invite this email, and open the link they send.",
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

  /* One transaction, so a failure leaves no account without its project, and
     a link spent by another browser in between leaves no account at all. */
  const { user, joined } = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email, name, passwordHash, color: pickAvatarColor(email) })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        color: users.color,
        emoji: users.avatarEmoji,
      });
    if (!token) return { user, joined: null };
    const joined = await spendInvite(tx, token, email);
    if (!joined) throw new HttpError(400, INVITE_IS_DEAD);
    await joinProject(tx, { projectId: joined, userId: user.id, role: "member" });
    return { user, joined };
  });

  if (joined) await broadcast({ projectId: joined, scope: "project" });

  await createSession(user.id);
  return json({ user });
}
