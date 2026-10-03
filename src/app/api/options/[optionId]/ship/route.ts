import { HttpError } from "@/lib/auth";
import { adminOnly, body, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { optionPropertyId, withProjectLock } from "@/lib/queries";
import { readShipRest } from "@/lib/ship";
import { shipOptionIn } from "@/lib/ship-option";

type Ctx = { params: Promise<{ optionId: string }> };

/**
 * Ships one column: the release or the sprint an option of a select stands for.
 *
 * The tasks in it that are over are archived, the rest go where the body says
 * — to the next option, nowhere, or out of the property — and the option
 * writes the day it shipped. It is one act, so it is one transaction under the
 * project lock, one bell on the stream and one webhook: every feed line it
 * writes carries the same `shipId`, as the lines of one import share theirs.
 * The transaction is `shipOptionIn`, which the roll of an ended sprint uses too.
 *
 * It is `adminOnly`, which is `humanOnly` too. One press here clears a whole
 * column and closes an option everybody shares, which is a decision about the
 * board, never work on a task.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { optionId } = await ctx.params;
  const owner = await optionPropertyId(optionId);
  if (!owner) throw new HttpError(404, "Option not found.");
  const { projectId, propertyId } = owner;
  const { user, membership } = await guard(projectId);
  adminOnly(user, membership, "ship a column");

  const read = readShipRest(await body<{ rest?: unknown }>(req));
  if ("error" in read) throw new HttpError(400, read.error);
  const { rest } = read;

  const { answer, ring } = await withProjectLock(projectId, (tx) =>
    shipOptionIn(tx, { projectId, propertyId, optionId, rest, actorId: user.id, rolled: false }),
  );

  await ring();
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json(answer);
});
