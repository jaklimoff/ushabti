/**
 * Whether this instance still takes new accounts. A board on the open internet
 * wants to stop after the team has signed up; the limiter slows a stranger,
 * this shuts the door. Only "closed" closes it: the production compose file
 * passes the setting empty when `.env` leaves it out, and empty is open.
 */
export function signupIsOpen(env: Record<string, string | undefined> = process.env): boolean {
  return (env.USHABTI_SIGNUP ?? "open").toLowerCase() !== "closed";
}
