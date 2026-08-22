import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentTokens } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { guard, humanOnly, json, route } from "@/lib/api";

type Ctx = { params: Promise<{ tokenId: string }> };

/** Revokes a token. The row stays, so the list can still show what it was. */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const { tokenId } = await ctx.params;

  const [token] = await db
    .select({ id: agentTokens.id, projectId: agentTokens.projectId })
    .from(agentTokens)
    .where(eq(agentTokens.id, tokenId))
    .limit(1);
  if (!token) throw new HttpError(404, "Token not found.");

  const { user, membership } = await guard(token.projectId);
  humanOnly(user);
  if (membership.role !== "owner") throw new HttpError(403, "Only the owner can revoke a token.");

  await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.id, tokenId));
  return json({ ok: true });
});
