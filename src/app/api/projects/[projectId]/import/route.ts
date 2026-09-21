import { broadcast, clientIdOf, guard, json, ownerOnly, route } from "@/lib/api";
import { applyImport, projectShape } from "@/lib/import/apply";
import { planImport } from "@/lib/import/plan";
import { readImportRequest } from "@/lib/import/request";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Brings a board in, once.
 *
 * The file is planned again here rather than trusted from the preview: the
 * browser sends the same file and the answer the owner gave, and the server
 * is the only thing that decides what is written. A card this project already
 * took is left out by the plan, so pressing **Import** twice makes nothing
 * twice.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "bring a board in");

  const { board, ask } = await readImportRequest(req);
  const plan = planImport(board, await projectShape(projectId), ask);
  const made = await applyImport({ projectId, actorId: user.id, plan });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ made }, 201);
});
