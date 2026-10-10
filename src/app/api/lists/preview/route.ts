import { requireActor, requireMembership } from "@/lib/auth";
import { body, humanOnly, json, readId, route } from "@/lib/api";
import { sourceCount } from "@/lib/lists";
import { boardsOnce, sourceShape } from "@/lib/lists-load";

/**
 * One project as a list would read it under these rules, before any list
 * exists: what its chips need, and how many tasks it gives. It writes
 * nothing, which is why the new list's page can ask it on every change.
 */
export const POST = route(async (req) => {
  const user = await requireActor();
  humanOnly(user);
  const input = await body<{ projectId?: unknown; filters?: unknown }>(req);
  const projectId = readId(input.projectId, "project");
  const { role } = await requireMembership(user.id, projectId);
  const boardOf = boardsOnce(user.id);
  const row = { id: projectId, role };
  const source = await sourceShape({ id: "", projectId, filters: input.filters }, row, boardOf);
  return json({ source, count: sourceCount(input.filters, await boardOf(row), user.id) });
});
