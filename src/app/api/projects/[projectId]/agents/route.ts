import { db } from "@/db";
import { projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, humanOnly, json, route, str } from "@/lib/api";
import { loadAgents } from "@/lib/agents";
import { pickAvatarColor } from "@/lib/colors";
import type { AgentDTO } from "@/lib/types";

type Ctx = { params: Promise<{ projectId: string }> };

/** Every agent of the project, with the tokens that are still live. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { projectId } = await ctx.params;
  await guard(projectId);
  return json({ agents: await loadAgents(projectId) });
});

/**
 * Creates a machine member. It has no password and no email, and from here on
 * the board treats it like any other member: it can hold a person property,
 * write comments and appear in the activity log.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  humanOnly(user);
  if (membership.role !== "owner") throw new HttpError(403, "Only the owner can add an agent.");

  const input = await body<{ name?: string }>(req);
  const name = str(input.name, "Name", { max: 80 });

  const [agent] = await db
    .insert(users)
    .values({
      name,
      kind: "agent",
      email: null,
      passwordHash: null,
      color: pickAvatarColor(`${projectId}:${name}`),
    })
    .returning({ id: users.id, name: users.name, color: users.color, createdAt: users.createdAt });

  await db.insert(projectMembers).values({ projectId, userId: agent.id, role: "member" });
  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });

  return json(
    {
      agent: {
        id: agent.id,
        name: agent.name,
        color: agent.color,
        createdAt: agent.createdAt.toISOString(),
        tokens: [],
      } satisfies AgentDTO,
    },
    201,
  );
});
