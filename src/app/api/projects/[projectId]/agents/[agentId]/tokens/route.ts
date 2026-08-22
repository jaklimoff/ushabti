import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentTokens, projectMembers, users } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, guard, humanOnly, json, route, str } from "@/lib/api";
import { mintToken } from "@/lib/agents";

type Ctx = { params: Promise<{ projectId: string; agentId: string }> };

/**
 * Issues a token. The answer carries the only copy of the plain text: the
 * table keeps its digest, so nobody, including the owner, can read it again.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId, agentId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  humanOnly(user);
  if (membership.role !== "owner") throw new HttpError(403, "Only the owner can issue a token.");

  const input = await body<{ name?: string }>(req);
  const name = str(input.name ?? "Token", "Token name", { max: 60 });

  const [agent] = await db
    .select({ id: users.id, kind: users.kind })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, agentId)))
    .limit(1);

  if (!agent) throw new HttpError(404, "That agent is not in this project.");
  if (agent.kind !== "agent") throw new HttpError(400, "Only an agent can hold a token.");

  const minted = mintToken();
  const [row] = await db
    .insert(agentTokens)
    .values({
      agentId,
      projectId,
      name,
      hash: minted.hash,
      prefix: minted.prefix,
      createdBy: user.id,
    })
    .returning({ id: agentTokens.id, createdAt: agentTokens.createdAt });

  return json(
    {
      token: {
        id: row.id,
        name,
        prefix: minted.prefix,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: null,
      },
      /** Shown once. It is never readable again. */
      secret: minted.token,
    },
    201,
  );
});
