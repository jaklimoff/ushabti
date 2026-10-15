import { HttpError, requireActor } from "@/lib/auth";
import { body, humanOnly, json, route } from "@/lib/api";
import { checkSources, drawChart, readSources } from "@/lib/charts-load";
import { boardsOnce } from "@/lib/lists-load";

/**
 * A chart as it would be drawn, before it exists. It counts through the one
 * function a saved chart does and writes nothing, which is why the picker can
 * ask it on every change.
 */
export const POST = route(async (req) => {
  const user = await requireActor();
  humanOnly(user);
  const sources = readSources(await body(req));
  const { roles } = await checkSources(sources);
  const boardOf = boardsOnce(user.id);
  const boards = new Map(
    await Promise.all(
      sources.map(
        async (s, i) => [s.projectId, await boardOf({ id: s.projectId, role: roles[i] })] as const,
      ),
    ),
  );
  const chart = await drawChart({ id: "", sources }, (id) => boards.get(id));
  if (!chart) throw new HttpError(400, "A chart counts the options of a select.");
  return json({ chart });
});
