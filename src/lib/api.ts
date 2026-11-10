import "server-only";
import { NextResponse } from "next/server";
import { HttpError, PERSONAL_REFUSAL, requireActor, requireMembership, requireUser } from "./auth";
import { forgetChangelog } from "./changelog-shelf";
import { publish, type BoardEvent } from "./events";
import { isId, notAnId } from "./ids";
import {
  AGENT_ACT_WORDS,
  agentMay,
  canManage,
  isOwner,
  outranks,
  roleChangeRefusal,
  type AgentAct,
  type AgentActs,
} from "./roles";
import { inRequest } from "./via";
import { isDatabaseTimeout } from "@/db/timeouts";

export { HttpError };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(status: number, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: message }, { status, headers });
}

/** Wraps a route handler so thrown HttpErrors become clean JSON responses. */
export function route<Ctx>(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    let res: Response;
    try {
      res = await inRequest(() => handler(req, ctx));
    } catch (err) {
      if (err instanceof HttpError) res = fail(err.status, err.message, err.headers);
      else if (isDatabaseTimeout(err)) {
        /* A wait ran out: the database is busy, not broken, and a retry may pass. */
        console.error("[ushabti] database timeout", req.method, new URL(req.url).pathname, err);
        res = fail(503, "The server is busy. Try again in a moment.", { "Retry-After": "5" });
      } else {
        console.error("[ushabti] route error", err);
        res = fail(500, "Something went wrong on the server.");
      }
    }
    /* Plain, never packed here: Next 16.4.5 strips Content-Encoding from a
       route's answer and still sends the packed bytes, which no browser can
       read (vercel/next.js#101192). Packing belongs to the server in front. */
    return res;
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "The request body must be JSON.");
  }
}

export function str(
  value: unknown,
  field: string,
  opts: { max?: number; min?: number } = {},
): string {
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text.`);
  const trimmed = value.trim();
  const min = opts.min ?? 1;
  if (trimmed.length < min) throw new HttpError(400, `${field} cannot be empty.`);
  if (opts.max && trimmed.length > opts.max)
    throw new HttpError(400, `${field} is too long (max ${opts.max} characters).`);
  return trimmed;
}

export function optionalStr(value: unknown, field: string, max = 20_000): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text.`);
  if (value.length > max) throw new HttpError(400, `${field} is too long.`);
  return value;
}

/**
 * An id, read before the database sees it.
 *
 * Every id is a UUID, and Postgres answers anything else with an error we
 * cannot tell from a fault of ours, so the caller was handed a `500` for a
 * request that was merely wrong. This is the one place that says so. The
 * lookups every route already goes through — `guard`, `taskProjectId`,
 * `runContext` and their neighbours — call it, so no route has to remember.
 */
export function readId(value: unknown, what: string): string {
  if (!isId(value)) throw new HttpError(400, notAnId(what));
  return value;
}

/**
 * Authenticates the caller and confirms membership of the project. The caller
 * is a person with a session cookie or an agent with a token; every route
 * below this line treats the two the same.
 */
export async function guard(projectId: string) {
  const user = await requireActor();
  /* After the caller is known, so a project route still answers a stranger
     "sign in first". A task route cannot: it reads the task to find the
     project, so `taskProjectId` has already read the id by then. */
  readId(projectId, "project");
  if (user.tokenProjectId && user.tokenProjectId !== projectId) {
    throw new HttpError(403, "That token belongs to another project.");
  }
  const membership = await requireMembership(user.id, projectId);
  return { user, membership };
}

/** For the few routes only a person may call. */
export function humanOnly(actor: { kind: string }) {
  if (actor.kind !== "human") throw new HttpError(403, "Only a person can do this.");
}

/**
 * For what lets somebody or something in, or hands data out on its own:
 * agents and their tokens, members, invites, reset links, webhooks, the
 * owner's acts and personal tokens themselves. A personal token is its person
 * on a board, but a leaked one must never be able to open the door to anybody
 * else, so these ask for a session.
 */
export function signedInOnly(actor: { personalTokenId?: string }) {
  if (actor.personalTokenId) throw new HttpError(403, PERSONAL_REFUSAL);
}

/** For the run routes, which belong to the agent doing the work. */
export function agentOnly(actor: { kind: string }) {
  if (actor.kind !== "agent") throw new HttpError(403, "Only an agent can do this.");
}

/**
 * For the acts an admin can switch off for one agent on one board. A person,
 * with a session or a personal token, always passes: the switches are an
 * agent's and only take away. The rule is `agentMay` in `roles.ts`.
 */
export function mayOnly(
  actor: { kind: string; name: string },
  membership: { acts: AgentActs },
  ...acts: AgentAct[]
) {
  if (actor.kind !== "agent") return;
  for (const act of acts) {
    if (agentMay(membership.acts, act)) continue;
    throw new HttpError(
      403,
      `This project does not let ${actor.name} ${AGENT_ACT_WORDS[act].verb}.`,
    );
  }
}

/**
 * People, agents and the shape of a project belong to the owner and the
 * admins. A member writes values, comments and runs all day; only an admin or
 * the owner removes a property, an option or a view, adds a person or issues a
 * token, and only a person does it at all. An agent that loses a token would
 * otherwise take the board apart with it. The rule itself is `canManage` in
 * `roles.ts`, which the settings panels read too.
 */
export function adminOnly(actor: { kind: string }, membership: { role: string }, what: string) {
  humanOnly(actor);
  if (!canManage(membership.role)) {
    throw new HttpError(403, `Only the owner or an admin can ${what}.`);
  }
}

/**
 * For the few acts that stay the owner's alone: deleting the project, handing
 * it over, and changing an admin's role. An admin who could do these could
 * remove the owner, which is the thing a second owner would have done. None
 * is open to a personal token.
 */
export function ownerOnly(
  actor: { kind: string; personalTokenId?: string },
  membership: { role: string },
  what: string,
) {
  humanOnly(actor);
  signedInOnly(actor);
  if (!isOwner(membership.role)) throw new HttpError(403, `Only the owner can ${what}.`);
}

/**
 * For acting on one other person: removing them or making them a reset link.
 * An admin may act on a member, and only the owner on an admin, so two admins
 * cannot take each other out. `what` is the verb, as in "remove".
 */
export function outranksOnly(
  actor: { kind: string },
  membership: { role: string },
  target: { role: string },
  what: string,
) {
  adminOnly(actor, membership, `${what} a member`);
  if (outranks(membership.role, target.role)) return;
  throw new HttpError(
    403,
    isOwner(target.role) ? `Nobody can ${what} the owner.` : `Only the owner can ${what} an admin.`,
  );
}

/** A role change, refused for the reason `roleChangeRefusal` gives. */
export function roleChangeOnly(
  actor: { kind: string },
  change: Parameters<typeof roleChangeRefusal>[0],
) {
  humanOnly(actor);
  const refusal = roleChangeRefusal(change);
  if (refusal) throw new HttpError(refusal.status, refusal.message);
}

export { requireUser };

export function clientIdOf(req: Request): string | undefined {
  return req.headers.get("x-ushabti-client") ?? undefined;
}

export async function broadcast(event: BoardEvent) {
  // Every write goes out here, so the kept public changelog is forgotten here.
  forgetChangelog(event.projectId);
  await publish(event);
}
