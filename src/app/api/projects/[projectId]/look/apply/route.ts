import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, humanOnly, json, route } from "@/lib/api";
import { writeLook } from "@/lib/look-write";
import { withProjectLocks } from "@/lib/queries";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * This project's look goes out to the projects the body names: each takes
 * the write Copy from… makes, with this project as the one copied from. This
 * project is only read. Every project is written in one transaction under
 * all their locks, so a failure in one writes nothing anywhere and the
 * numbers the question named stay true.
 *
 * A person does this, and only into projects they are a member of: one that
 * is not refuses the whole request before anything is written.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);
  humanOnly(user);

  const input = await body<{ to?: unknown; layout?: unknown; looks?: unknown }>(req);
  const layout = input.layout === true;
  const looks = input.looks === true;
  if (!layout && !looks) throw new HttpError(400, "Pick what to apply.");
  if (!Array.isArray(input.to) || input.to.length === 0) {
    throw new HttpError(400, "Pick a project to apply to.");
  }
  if (!input.to.every((id): id is string => typeof id === "string")) {
    throw new HttpError(400, "Pick a project to apply to.");
  }
  const to = [...new Set(input.to)];
  if (to.includes(projectId)) throw new HttpError(400, "A project cannot apply to itself.");
  /* As any project route refuses it, so the answer says nothing about it. */
  for (const id of to) await guard(id);

  await withProjectLocks(to, async (tx) => {
    for (const id of to) await writeLook(tx, id, projectId, { layout, looks });
  });

  const clientId = clientIdOf(req);
  for (const id of to) await broadcast({ projectId: id, scope: "board", clientId });
  return json({ applied: to });
});
