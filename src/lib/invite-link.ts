/**
 * The life of an invite link.
 *
 * Nothing here reads the database or the clock — the moment is an argument —
 * so a unit test drives the whole rule.
 */

/** What an invite token starts with, so a leaked one says what it is. */
export const INVITE_PREFIX = "ushi_";

/** How long an invite works. Long enough for a week away from the inbox. */
export const INVITE_DAYS = 7;

export const INVITE_MS = INVITE_DAYS * 24 * 60 * 60 * 1000;

export type StoredInvite = { hash: string | null; expiresAt: Date | null };

/**
 * Whether this invite still opens its project. One made before invites had
 * links carries no token, so nobody can hold it, and it opens nothing.
 */
export function inviteIsLive(invite: StoredInvite, now: Date): boolean {
  return (
    invite.hash !== null && invite.expiresAt !== null && invite.expiresAt.getTime() > now.getTime()
  );
}

/**
 * The one sentence a dead invite gets, whether it is old, spent, withdrawn or
 * was never real. It never says whether an account exists.
 */
export const INVITE_IS_DEAD = `This invite does not work any more. An invite works once, for ${INVITE_DAYS} days. Ask the person who invited you for a new invite.`;
