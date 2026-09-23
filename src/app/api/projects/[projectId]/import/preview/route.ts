import { guard, json, adminOnly, route } from "@/lib/api";
import { planImport, previewOf } from "@/lib/import/plan";
import { projectShape } from "@/lib/import/apply";
import { readImportRequest } from "@/lib/import/request";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * What an import would do. It writes nothing.
 *
 * An import makes properties and options, and the shape of a project is the
 * owner's, so the reading of it is the owner's too: a member who could not
 * press **Import** has no use for the page that leads to it.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  adminOnly(user, membership, "bring a board in");

  const { board, ask } = await readImportRequest(req);
  const plan = planImport(board, await projectShape(projectId), ask);
  return json({ preview: previewOf(plan) });
});
