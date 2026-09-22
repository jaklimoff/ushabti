import { broadcast, clientIdOf, guard, json, ownerOnly, route } from "@/lib/api";
import { applyImport } from "@/lib/import/apply";
import { readImportRequest } from "@/lib/import/request";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Brings a board in, once.
 *
 * The file is planned again here rather than trusted from the preview: the
 * browser sends the same file and the answer the owner gave, and the server is
 * the only thing that decides what is written. That planning happens under the
 * project lock, inside `applyImport`, because what the import does depends on
 * what the board already holds — so two of these arriving together cannot both
 * decide that a card is new.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "bring a board in");

  const { board, ask } = await readImportRequest(req);
  const made = await applyImport({ projectId, actorId: user.id, board, ask });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ made }, 201);
});
