import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, HttpError, refuseIfLimited, verifyPassword } from "@/lib/auth";
import { body, broadcast, json, route } from "@/lib/api";
import { acceptInvite } from "@/lib/invites";
import {
  addressOf,
  limiter,
  loginByAddress,
  loginByEmail,
  signupByAddress,
} from "@/lib/rate-limit";

export const POST = route(async (req: Request) => {
  const input = await body<{ email?: string; password?: string; invite?: string }>(req);
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  /* Two keys, because an attack comes either way: one address trying many
     accounts, or many addresses trying one. Both are counted before the
     password is checked, so a spent key costs nothing to refuse. */
  const byAddress = loginByAddress(addressOf(req.headers));
  const byEmail = loginByEmail(email);
  refuseIfLimited(byAddress);
  refuseIfLimited(byEmail);

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    limiter.hit(byAddress);
    limiter.hit(byEmail);
    throw new HttpError(401, "Wrong email or password.");
  }

  /* The password was right, so the tries this account spent were somebody
     mistyping. The address keeps its count: a stranger guessing at one of
     these accounts must not be forgiven by the owner of another. */
  limiter.clear(byEmail);

  /* Signing in from an invite link joins its project, once the password has
     proved who this is. An invite that does not work signs nobody in, so the
     page can say why and the person is not left signed in somewhere else. */
  const token = typeof input.invite === "string" && input.invite ? input.invite : null;
  /* A refused token is charged to the sign-up key, as the invite page and the
     accept route charge it, so a known password is no way to walk tokens. */
  const key = signupByAddress(addressOf(req.headers));
  if (token) refuseIfLimited(key);
  let joined: string | null = null;
  try {
    joined = token ? await acceptInvite(token, { id: user.id, email }) : null;
  } catch (err) {
    if (err instanceof HttpError) limiter.hit(key);
    throw err;
  }
  if (joined) await broadcast({ projectId: joined, scope: "project" });

  await createSession(user.id);
  return json({
    user: { id: user.id, email, name: user.name, color: user.color, emoji: user.avatarEmoji },
    joined,
  });
});
