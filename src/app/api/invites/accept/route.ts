import { HttpError, refuseIfLimited, requireUser } from "@/lib/auth";
import { body, broadcast, json, route } from "@/lib/api";
import { acceptInvite } from "@/lib/invites";
import { addressOf, limiter, signupByAddress } from "@/lib/rate-limit";

/**
 * The button on an invite page, for somebody already signed in. Only a
 * session presses it: the invite proves an email, and a session is the only
 * proof that the person holding the link owns the account with that email.
 *
 * A refused token counts against the sign-up key, as a dead link on the page
 * does, so this is no free oracle for walking tokens.
 */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const key = signupByAddress(addressOf(req.headers));
  refuseIfLimited(key);
  const input = await body<{ token?: unknown }>(req);
  const token = typeof input.token === "string" ? input.token : "";
  try {
    const projectId = await acceptInvite(token, user);
    await broadcast({ projectId, scope: "project" });
    return json({ joined: projectId });
  } catch (err) {
    if (err instanceof HttpError) limiter.hit(key);
    throw err;
  }
});
