import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, sessions, users } from "@/db/schema";
import { requests } from "./headers";

/**
 * Route tests call the real handlers with the real SQL, over an in-memory
 * Postgres. A test file opens with the three stand-ins, which Vitest only
 * hoists from the test file itself:
 *
 * ```ts
 * vi.mock("server-only", () => ({}));
 * vi.mock("@/db", () => import("@/test/db"));
 * vi.mock("next/headers", () => import("@/test/headers"));
 * ```
 *
 * Then `api(caller)` answers a path as the server would, so a test moved
 * down from `e2e/` reads as it did there. A caller is a person with a session
 * row, or an agent with a token; their role is the row in `project_members`.
 */

/** Whoever sends a request: the headers it carries, and who that is. */
export type Caller = { id: string; name: string; headers: Record<string, string> };

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "PUT" | "DELETE", Handler>>;

/* Every route of the app, found as Next finds them: by folder. */
const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<RouteModule>>;
  }
).glob("../app/api/**/route.ts");
const table = Object.entries(modules).map(([file, load]) => {
  const parts = file
    .replace("../app", "")
    .replace(/\/route\.ts$/, "")
    .split("/")
    .slice(1);
  return { parts, load };
});

function find(path: string) {
  const asked = path.split("/").slice(1);
  /* A folder named for a word wins over a folder named for an id, as in Next:
     `/api/views/<id>/lens/promote` is not `[viewId]/[x]`. */
  let best: {
    load: () => Promise<RouteModule>;
    params: Record<string, string>;
    score: number;
  } | null = null;
  for (const { parts, load } of table) {
    if (parts.length !== asked.length) continue;
    const params: Record<string, string> = {};
    let score = 0;
    const fits = parts.every((part, i) => {
      if (part.startsWith("[")) return ((params[part.slice(1, -1)] = asked[i]), true);
      score += 1;
      return part === asked[i];
    });
    if (fits && (!best || score > best.score)) best = { load, params, score };
  }
  if (!best) throw new Error(`No route answers ${path}.`);
  return best;
}

/** One request to the route that answers `path`, as `caller`. */
export async function call(
  caller: Caller | null,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  data?: unknown,
): Promise<Response> {
  const url = new URL(path, "http://localhost");
  const { load, params } = find(url.pathname);
  const handler = (await load())[method];
  if (!handler) return new Response(null, { status: 405 });
  const req = new Request(url, {
    method,
    headers: { "content-type": "application/json", ...caller?.headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return requests.run(req, () => handler(req, { params: Promise.resolve(params) }));
}

/** The calls of one caller, named as the end to end helpers name them. */
export function api(caller: Caller | null) {
  return {
    get: (path: string) => call(caller, "GET", path),
    post: (path: string, data: unknown = {}) => call(caller, "POST", path, data),
    patch: (path: string, data: unknown = {}) => call(caller, "PATCH", path, data),
    put: (path: string, data: unknown = {}) => call(caller, "PUT", path, data),
    del: (path: string) => call(caller, "DELETE", path),
  };
}

/** The body of an answer that has to be a success. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test reads the answer as the e2e spec it replaced did, field by field.
export async function ok<T = any>(answer: Promise<Response> | Response): Promise<T> {
  const res = await answer;
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

let made = 0;
/** A name nobody else in this file has. */
export function unique(prefix: string): string {
  made += 1;
  return `${prefix} ${made}`;
}

/** A person with an account and a session, signed in. */
export async function person(name = "Test Person"): Promise<Caller> {
  const [user] = await db
    .insert(users)
    .values({
      name,
      email: `${randomBytes(6).toString("hex")}@example.com`,
      passwordHash: "not used",
      kind: "human",
      color: "#888888",
    })
    .returning({ id: users.id });
  const session = randomBytes(32).toString("base64url");
  await db
    .insert(sessions)
    .values({ id: session, userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) });
  return { id: user.id, name, headers: { cookie: `ushabti_session=${session}` } };
}

/** A new project, made by `owner` through the route a person uses. */
export async function project(owner: Caller, name = unique("Board")) {
  const { project } = await ok<{ project: { id: string; key: string } }>(
    api(owner).post("/api/projects", { name }),
  );
  return project;
}

/** Puts `who` on the project with `role`, as an accepted invite would. */
export async function join(projectId: string, who: Caller, role: "admin" | "member") {
  await db.insert(projectMembers).values({ projectId, userId: who.id, role });
}

/** An agent added by `owner`, with one token, and the calls it makes with it. */
export async function agent(owner: Caller, projectId: string, name = "Builder") {
  const made = await ok<{ agent: { id: string } }>(
    api(owner).post(`/api/projects/${projectId}/agents`, { name }),
  );
  const { secret, token } = await ok<{ secret: string; token: { id: string } }>(
    api(owner).post(`/api/projects/${projectId}/agents/${made.agent.id}/tokens`, {}),
  );
  const caller: Caller = {
    id: made.agent.id,
    name,
    headers: { authorization: `Bearer ${secret}` },
  };
  return { ...caller, caller, secret, tokenId: token.id, api: api(caller) };
}

/** A task made by `who` in the first column. */
export async function task(who: Caller, projectId: string, title: string) {
  const made = await ok<{ task: { id: string; key: string } }>(
    api(who).post(`/api/projects/${projectId}/tasks`, { title }),
  );
  return made.task;
}

/** The board as `who` reads it. */
export async function board(who: Caller, projectId: string) {
  return ok(api(who).get(`/api/projects/${projectId}/board`));
}

/**
 * Moves a run's clocks into the past, as `backdateRun` does for the end to
 * end tests: the lease is read against the database's clock.
 */
export async function backdateRun(runId: string, minutes: number): Promise<void> {
  await db.execute(sql`
    update agent_runs
       set updated_at    = now() - (${String(minutes)} || ' minutes')::interval,
           beat_at       = now() - (${String(minutes)} || ' minutes')::interval,
           report_due_at = report_due_at - (${String(minutes)} || ' minutes')::interval
     where id = ${runId}`);
}
