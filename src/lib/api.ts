import "server-only";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { NextResponse } from "next/server";
import { HttpError, requireActor, requireMembership, requireUser } from "./auth";
import { forgetChangelog } from "./changelog-shelf";
import { publish, type BoardEvent } from "./events";
import { isId, notAnId } from "./ids";
import { canManage, isOwner, outranks, roleChangeRefusal } from "./roles";

export { HttpError };

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);

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
      res = await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) res = fail(err.status, err.message, err.headers);
      else {
        console.error("[ushabti] route error", err);
        res = fail(500, "Something went wrong on the server.");
      }
    }
    return squeeze(req, res);
  };
}

/* Below this a packed answer is hardly smaller, and costs a pass of zlib. */
const SMALL = 1024;

/**
 * Packs a JSON answer when the caller accepts it. Next packs the pages but
 * leaves the route handlers' JSON raw, and the board read is over half a
 * megabyte. Only JSON: the stream must not pass through a packer, which holds
 * an event back until it has enough to pack.
 */
async function squeeze(req: Request, res: Response): Promise<Response> {
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("application/json") || !res.body || res.headers.has("content-encoding"))
    return res;
  const headers = new Headers(res.headers);
  headers.append("Vary", "Accept-Encoding");
  const plain = Buffer.from(await res.arrayBuffer());
  const encoding =
    plain.length < SMALL ? null : acceptedEncoding(req.headers.get("accept-encoding"));
  let sent: Buffer = plain;
  if (encoding === "br") {
    sent = await brotli(plain, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
  } else if (encoding === "gzip") {
    sent = await gzip(plain);
  }
  if (encoding) headers.set("Content-Encoding", encoding);
  headers.set("Content-Length", String(sent.length));
  return new Response(new Uint8Array(sent), {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/** Brotli first, then gzip; a coding with `q=0` is refused. */
export function acceptedEncoding(header: string | null): "br" | "gzip" | null {
  const accepted = new Set<string>();
  for (const part of (header ?? "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (q && Number(q.slice(2)) === 0) continue;
    accepted.add(name.trim());
  }
  if (accepted.has("br")) return "br";
  if (accepted.has("gzip")) return "gzip";
  return null;
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

/** For the run routes, which belong to the agent doing the work. */
export function agentOnly(actor: { kind: string }) {
  if (actor.kind !== "agent") throw new HttpError(403, "Only an agent can do this.");
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
 * remove the owner, which is the thing a second owner would have done.
 */
export function ownerOnly(actor: { kind: string }, membership: { role: string }, what: string) {
  humanOnly(actor);
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
