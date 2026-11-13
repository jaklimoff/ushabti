import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { guard, json, route } from "@/lib/api";
import { rulesHash } from "@/lib/agent-rules-hash";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * How to work on this board, for any member, a person or an agent. An agent
 * that files or refines tasks holds no run, so it has no claim to read the
 * rules from. The answer is the claim's own `rules` object, so a reader can
 * match the hash against either. It only reads: who writes the rules is the
 * project route's business.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { projectId } = await ctx.params;
  await guard(projectId);
  const [project] = await db
    .select({ agentRules: projects.agentRules })
    .from(projects)
    .where(eq(projects.id, projectId));
  const text = project?.agentRules ?? "";
  return json({ rules: { text, hash: rulesHash(text) } });
});
