import { HttpError, requireActor, requireMembership } from "@/lib/auth";
import { body, humanOnly, json, readId, route } from "@/lib/api";
import { drawChart } from "@/lib/charts-load";
import { boardsOnce } from "@/lib/lists-load";

/**
 * A chart as it would be drawn, before it exists. It counts through the one
 * function a saved chart does and writes nothing, which is why the picker can
 * ask it on every change.
 */
export const POST = route(async (req) => {
  const user = await requireActor();
  humanOnly(user);
  const input = await body<{ projectId?: unknown; propertyId?: unknown; optionId?: unknown }>(req);
  const projectId = readId(input.projectId, "project");
  const propertyId = readId(input.propertyId, "property");
  const optionId = readId(input.optionId, "option");
  const { role } = await requireMembership(user.id, projectId);
  const board = await boardsOnce(user.id)({ id: projectId, role });
  const chart = await drawChart({ id: "", projectId, propertyId, optionId }, board);
  if (!chart) throw new HttpError(400, "A chart counts the options of a select.");
  return json({ chart });
});
