/**
 * The life of a reset link.
 *
 * There is no email in Ushabti, so the way back into an account nobody can
 * sign in to is a person: the owner of a project you are in makes a link and
 * sends it by whatever channel the team already has.
 *
 * Nothing here reads the database and nothing here reads the clock — the
 * moment is an argument — so a unit test drives the whole rule.
 */

/**
 * What a reset token starts with. Its own word, and not the agent tokens'
 * `ush_`: a link that leaks into a log or a chat should say which kind of
 * secret it is, and a secret scanner should be able to tell them apart.
 */
export const RESET_PREFIX = "ushr_";

/** How long a link works. Long enough to reach somebody by hand. */
export const RESET_HOURS = 24;

export const RESET_MS = RESET_HOURS * 60 * 60 * 1000;

/** What a stored link is now. Only `live` opens an account. */
export type LinkLife = "live" | "used" | "expired" | "superseded";

export type StoredLink = {
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

/**
 * What this link is now. `newestAt` is when the newest link for the same
 * person was made, so a newer one takes an older one's place.
 *
 * A link is read afresh and never cleaned up, exactly as a filter is: making
 * one writes a single row and touches nothing else, so there is no second
 * write to lose and no race to lose it in. All four answers read the same on
 * screen — one sentence — and they are kept apart only because a rule that is
 * named can be tested.
 */
export function lifeOfLink(link: StoredLink, newestAt: Date, now: Date): LinkLife {
  if (link.usedAt) return "used";
  if (link.createdAt.getTime() < newestAt.getTime()) return "superseded";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "live";
}

/**
 * The one sentence a dead link gets, whichever way it died. It never says
 * whether an account exists: this page is open to anybody with a URL.
 */
export const LINK_IS_DEAD =
  "This link does not work any more. Ask the owner of your project for a new one.";
