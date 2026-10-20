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

/**
 * The roles a select on a People row may offer; empty when it draws no
 * select. Never "owner": the hand-over is the danger zone's, where it asks
 * first. The route still takes it, since that is how the danger zone sends it.
 */
export function rolesOffered(
  actor: string,
  target: string,
  targetKind: "human" | "agent",
  self: boolean,
): Role[] {
  const offered = ROLES.filter(
    (next) =>
      next === target ||
      (next !== "owner" && !roleChangeRefusal({ actor, target, targetKind, next, self })),
  );
  // A select with one choice changes nothing, so the row shows a tag instead.
  return offered.length > 1 ? offered : [];
}

/**
 * The acts an admin may switch off for one agent on one board. Each is an act
 * and not a route: the routes behind it ask `agentMay` through `mayOnly` in
 * `api.ts`. A switch only takes away. An agent with every switch on is the
 * member it always was, and no switch gives it more than a member has.
 */
export const AGENT_ACTS = [
  "create",
  "delete",
  "archive",
  "checklist",
  "structure",
  "ship",
] as const;
export type AgentAct = (typeof AGENT_ACTS)[number];
export type AgentActs = Partial<Record<AgentAct, boolean>>;

/** The name on the toggle, the words of the refusal, and the one word of a folded agent. */
export const AGENT_ACT_WORDS: Record<
  AgentAct,
  { label: string; verb: string; note: string; short: string }
> = {
  create: {
    label: "Create tasks",
    verb: "create tasks",
    note: "Add a task to the board.",
    short: "create",
  },
  delete: {
    label: "Delete tasks",
    short: "delete",
    verb: "delete tasks",
    note: "Delete a task, and restore a deleted one.",
  },
  archive: {
    short: "archive",
    label: "Archive tasks",
    verb: "archive tasks",
    note: "Archive a task, and put an archived one back.",
  },
  checklist: {
    short: "checklists",
    label: "Edit checklists",
    verb: "edit checklists",
    note: "Reword or remove a checklist item. Adding and ticking one stay open.",
  },
  structure: {
    short: "structure",
    label: "Change structure",
    verb: "change the structure",
    note: "Add a property, an option or a view; rename, recolour or reorder an option; rename a property; regroup or sort a view.",
  },
  ship: {
    short: "ship",
    label: "Ship releases",
    verb: "ship releases",
    note: "Ship or close a release or a sprint. A ship archives, so it needs Archive tasks too.",
  },
};

/** Delete starts off for every agent: a deleted task is gone for others. */
const ACT_DEFAULT: Record<AgentAct, boolean> = {
  create: true,
  delete: false,
  archive: true,
  checklist: true,
  structure: true,
  ship: true,
};

export function isAgentAct(value: unknown): value is AgentAct {
  return typeof value === "string" && (AGENT_ACTS as readonly string[]).includes(value);
}

/**
 * The stored switches, read afresh as a filter is. A word the code no longer
 * knows, or a value that is not on or off, is dropped, so a stored object can
 * never refuse something by accident.
 */
export function readAgentActs(stored: unknown): AgentActs {
  const acts: AgentActs = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return acts;
  for (const [act, on] of Object.entries(stored)) {
    if (isAgentAct(act) && typeof on === "boolean") acts[act] = on;
  }
  return acts;
}

/** Whether an agent with these switches may do this act on this board. */
export function agentMay(acts: AgentActs, act: AgentAct): boolean {
  return acts[act] ?? ACT_DEFAULT[act];
}

/** The acts switched off, in the order the toggles are drawn. */
export function actsOff(acts: AgentActs): AgentAct[] {
  return AGENT_ACTS.filter((act) => !agentMay(acts, act));
}

/** What a folded agent says it may do: "May everything but delete and ship". */
export function maySaid(acts: AgentActs): string {
  const off = actsOff(acts).map((act) => AGENT_ACT_WORDS[act].short);
  if (off.length === 0) return "May everything";
  const last = off.pop();
  return `May everything but ${off.length ? `${off.join(", ")} and ${last}` : last}`;
}
