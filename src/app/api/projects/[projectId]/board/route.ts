import { guard, json, route } from "@/lib/api";
import { loadBoard } from "@/lib/queries";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const { projectId } = await ctx.params;
  const { membership } = await guard(projectId);
  return json(await loadBoard(projectId, membership.role));
});
