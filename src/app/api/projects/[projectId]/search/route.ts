import { guard, json, route } from "@/lib/api";
import { searchArchived } from "@/lib/archive-search";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * The archived tasks whose description holds the words of `q`.
 *
 * The board read leaves those descriptions out, so this is the half of a
 * search the browser cannot answer by itself. It is guarded as the board read
 * is: any member, a person or an agent, because it says nothing the board
 * read did not say before.
 */
export const GET = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  await guard(projectId);
  const query = new URL(req.url).searchParams.get("q") ?? "";
  return json(await searchArchived(projectId, query));
});
