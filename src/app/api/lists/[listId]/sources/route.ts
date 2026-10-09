import { db } from "@/db";
import { listSources } from "@/db/schema";
import { body, json, readId, route } from "@/lib/api";
import { requireMembership } from "@/lib/auth";
import { boardsOnce, ownList, sourceShape, sourcesOf } from "@/lib/lists-load";
import { rankAfter } from "@/lib/rank";

type Ctx = { params: Promise<{ listId: string }> };

/**
 * One more project on the list, with no rules: it brings every task until
 * somebody says otherwise. Only a project the person is a member of.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { user, list } = await ownList((await ctx.params).listId);
  const input = await body<{ projectId?: unknown }>(req);
  const projectId = readId(input.projectId, "project");
  const { role } = await requireMembership(user.id, projectId);
  const sources = await sourcesOf([list.id]);
  const [source] = await db
    .insert(listSources)
    .values({
      listId: list.id,
      projectId,
      filters: { rules: [] },
      position: rankAfter(sources.at(-1)?.position),
    })
    .returning({
      id: listSources.id,
      projectId: listSources.projectId,
      filters: listSources.filters,
    });
  /* The page draws the new source's chips at once, so it gets what they read. */
  return json(
    { source: await sourceShape(source, { id: projectId, role }, boardsOnce(user.id)) },
    201,
  );
});
