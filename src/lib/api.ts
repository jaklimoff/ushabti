import "server-only";
import { NextResponse } from "next/server";
import { HttpError, requireActor, requireMembership, requireUser } from "./auth";
import { publish, type BoardEvent } from "./events";

export { HttpError };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** Wraps a route handler so thrown HttpErrors become clean JSON responses. */
export function route<Ctx>(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message);
      console.error("[ushabti] route error", err);
      return fail(500, "Something went wrong on the server.");
    }
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
 * Authenticates the caller and confirms membership of the project. The caller
 * is a person with a session cookie or an agent with a token; every route
 * below this line treats the two the same.
 */
export async function guard(projectId: string) {
  const user = await requireActor();
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

export { requireUser };

export function clientIdOf(req: Request): string | undefined {
  return req.headers.get("x-ushabti-client") ?? undefined;
}

export async function broadcast(event: BoardEvent) {
  await publish(event);
}
