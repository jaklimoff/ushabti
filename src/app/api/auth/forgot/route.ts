import { eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { HttpError, refuseIfLimited } from "@/lib/auth";
import { body, json, route, str } from "@/lib/api";
import { forgotConfig, forgotLink } from "@/lib/forgot";
import { forgotMail, sendMail } from "@/lib/mail";
import { addressOf, forgotByAddress, forgotByEmail, limiter } from "@/lib/rate-limit";
import { FORGOT_OFF, FORGOT_SENT, RESET_HOURS } from "@/lib/reset-link";
import { makeResetToken } from "@/lib/resets";

/**
 * "Forgot password?": emails a reset link to the account that uses this email.
 *
 * No auth, so nothing here may say whether an account exists. Every email
 * gets the same sentence, and the answer goes out before anything is looked
 * up: the lookup, the token and the send run in `after()`, so the time to
 * answer is the same for a real email and an unknown one. Both keys are
 * counted on every request for the same reason.
 */
export const POST = route(async (req: Request) => {
  const config = forgotConfig();
  if (!config.on) throw new HttpError(404, FORGOT_OFF);

  const input = await body<{ email?: string }>(req);
  // Capped as sign-up caps it, before it becomes a key the limiter keeps for ten minutes.
  const email = str(input.email ?? "", "Email", { max: 200, min: 0 }).toLowerCase();

  const byAddress = forgotByAddress(addressOf(req.headers));
  const byEmail = forgotByEmail(email);
  refuseIfLimited(byAddress);
  refuseIfLimited(byEmail);
  limiter.hit(byAddress);
  limiter.hit(byEmail);

  if (!email.includes("@")) throw new HttpError(400, "Type the email of your account.");

  after(() => emailLink(email, config.origin));
  return json({ ok: true, message: FORGOT_SENT });
});

/**
 * An agent has no password to forget, and a person with none signs in some
 * other way, so both get nothing, as an unknown email does. It never throws:
 * nobody is waiting for it.
 */
async function emailLink(email: string, origin: string) {
  try {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        kind: users.kind,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user || user.kind === "agent" || !user.passwordHash) return;

    const token = await makeResetToken(user.id, null);
    await sendMail(
      forgotMail({
        to: email,
        name: user.name,
        link: forgotLink(origin, token),
        hours: RESET_HOURS,
      }),
    );
  } catch (err) {
    console.error(`Could not make a forgot link: ${err instanceof Error ? err.message : err}`);
  }
}
