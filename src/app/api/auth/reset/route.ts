import { createSession, HttpError, refuseIfLimited } from "@/lib/auth";
import { body, json, route } from "@/lib/api";
import { addressOf, limiter, resetByAddress } from "@/lib/rate-limit";
import { LINK_IS_DEAD } from "@/lib/reset-link";
import { useResetToken } from "@/lib/resets";

/**
 * Sets a password with a link the owner made, and signs this browser in.
 *
 * No auth: whoever holds the link is the only person this can be. A dead link
 * is counted against the calling address, because guessing a token is the one
 * attack there is here — and it answers the same sentence the page shows, so
 * nothing here says whether an account exists.
 */
export const POST = route(async (req: Request) => {
  const key = resetByAddress(addressOf(req.headers));
  refuseIfLimited(key);

  const input = await body<{ token?: string; password?: string }>(req);
  const token = typeof input.token === "string" ? input.token : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (password.length < 8) {
    throw new HttpError(400, "The password must have at least 8 characters.");
  }

  const userId = await useResetToken(token, password);
  if (!userId) {
    limiter.hit(key);
    throw new HttpError(400, LINK_IS_DEAD);
  }

  await createSession(userId);
  return json({ ok: true });
});
