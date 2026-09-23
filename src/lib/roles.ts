/**
 * The three roles a person can hold on a project, and the one rule about them.
 *
 * The owner is one person. An admin does all that the owner does except three
 * things: delete the project, hand it to somebody else, and change an admin's
 * role. A member writes values, comments and runs, as everybody does.
 *
 * An agent is always a member. The guards in `api.ts` put `humanOnly` in front
 * of every one of these answers, so a token can never act as an admin, even
 * if a row somehow said it was one.
 *
 * This file is plain on purpose: the routes and the settings panels read the
 * same answers, so a button is shown exactly where the route will let it
 * through.
 */

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

const RANK: Record<Role, number> = { owner: 2, admin: 1, member: 0 };

/** A word we do not know ranks as a member, so it opens nothing. */
function rankOf(role: string): number {
  return isRole(role) ? RANK[role] : 0;
}

/** The owner. Alone may delete the project, hand it over, and change an admin. */
export function isOwner(role: string): boolean {
  return role === "owner";
}

/** People, agents, tokens, webhooks, import and the shape of the project. */
export function canManage(role: string): boolean {
  return rankOf(role) >= RANK.admin;
}

/**
 * Whether somebody in one role may act on somebody in another: remove them,
 * make them a reset link, change their role. Only from above, so two admins
 * cannot take each other out, and nobody acts on the owner.
 */
export function outranks(actor: string, target: string): boolean {
  return canManage(actor) && rankOf(actor) > rankOf(target);
}

export type Refusal = { status: 400 | 403; message: string };

/**
 * Why a role change is refused, or null when it may go ahead. The route and
 * the select both ask this, so the select offers only what the route takes.
 * Making somebody the owner is a hand-over: the route moves the old owner to
 * admin in the same transaction, so there is always exactly one owner.
 */
export function roleChangeRefusal(change: {
  actor: string;
  target: string;
  targetKind: "human" | "agent";
  next: string;
  self: boolean;
}): Refusal | null {
  const { actor, target, targetKind, next, self } = change;
  if (!isRole(next)) return { status: 400, message: "A role is owner, admin or member." };
  if (!canManage(actor)) {
    return { status: 403, message: "Only the owner or an admin can change a role." };
  }
  if (targetKind === "agent") return { status: 400, message: "An agent is always a member." };
  if (self) return { status: 400, message: "You cannot change your own role." };
  if (next === "owner" && !isOwner(actor)) {
    return { status: 403, message: "Only the owner can hand the project over." };
  }
  if (!outranks(actor, target)) {
    return {
      status: 403,
      message: isOwner(target)
        ? "The owner's role changes only when they hand the project over."
        : "Only the owner can change an admin's role.",
    };
  }
  return null;
}

/** The roles a select on this row may offer; empty when it draws no select. */
export function rolesOffered(
  actor: string,
  target: string,
  targetKind: "human" | "agent",
  self: boolean,
): Role[] {
  const offered = ROLES.filter(
    (next) => next === target || !roleChangeRefusal({ actor, target, targetKind, next, self }),
  );
  // A select with one choice changes nothing, so the row shows a tag instead.
  return offered.length > 1 ? offered : [];
}
