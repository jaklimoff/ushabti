import { guard, json, route } from "@/lib/api";
import { loadSettings } from "@/lib/queries";

type Ctx = { params: Promise<{ projectId: string }> };

/* What Settings reads when the stream rings: the board's shape without the
   board's tasks. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  const viewerId = user.kind === "human" ? user.id : null;
  return json(await loadSettings(projectId, membership.role, viewerId));
});
