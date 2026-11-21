import { guard, json, route } from "@/lib/api";
import { loadBoard } from "@/lib/queries";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  /* An agent has no lens, so it is not asked for one: the board it reads is
     the view's filters and nothing a person added to their own screen. */
  const viewerId = user.kind === "human" ? user.id : null;
  const acts = user.kind === "agent" ? membership.acts : null;
  /* The Archived page asks for the release each archived task shipped in. */
  const search = new URL(req.url).searchParams;
  const shipped = search.get("shipped") === "1";
  /* The stamp of the archived list the caller already holds. While it still
     holds, the answer leaves the list out and says the stamp again. */
  const held = search.get("archivedStamp") || null;
  return json(await loadBoard(projectId, membership.role, viewerId, acts, shipped, held));
});
