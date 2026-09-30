import { adminOnly, guard, route } from "@/lib/api";
import { exportFileName, loadExport } from "@/lib/export";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * The whole project as one file to save.
 *
 * It is an admin's, and a person's: the file holds every member's email and
 * every word on the board, and an agent that loses its token must not hand
 * that out.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  adminOnly(user, membership, "download the project");

  const now = new Date();
  const file = await loadExport(projectId, now);
  const name = exportFileName(file.project.key, file.project.timeZone, now);

  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
});
