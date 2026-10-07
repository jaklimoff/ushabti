import { projectMembers, users } from "@/db/schema";
import { body, broadcast, clientIdOf, adminOnly, guard, json, route, str } from "@/lib/api";
import { loadAgents, refuseTakenName } from "@/lib/agents";
import { pickAvatarColor } from "@/lib/colors";
import { withProjectLock } from "@/lib/queries";
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
  adminOnly(user, membership, "add an agent");

  const input = await body<{ name?: string }>(req);
  const name = str(input.name, "Name", { max: 80 });

  const agent = await withProjectLock(projectId, async (tx) => {
    await refuseTakenName(tx, projectId, name);
    const [agent] = await tx
      .insert(users)
      .values({
        name,
        kind: "agent",
        email: null,
        passwordHash: null,
        color: pickAvatarColor(`${projectId}:${name}`),
      })
      .returning({
        id: users.id,
        name: users.name,
        color: users.color,
        emoji: users.avatarEmoji,
        createdAt: users.createdAt,
      });

    await tx.insert(projectMembers).values({ projectId, userId: agent.id, role: "member" });
    return agent;
  });
  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });

  return json(
    {
      agent: {
        id: agent.id,
        name: agent.name,
        color: agent.color,
        emoji: agent.emoji,
        createdAt: agent.createdAt.toISOString(),
        tokens: [],
      } satisfies AgentDTO,
    },
    201,
  );
});
