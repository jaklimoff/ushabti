import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, mayOnly, route } from "@/lib/api";
import { optionPropertyId, withProjectLock } from "@/lib/queries";
import { readShipRest, readShipStrays } from "@/lib/ship";
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
 * With `strays: true` a release also takes the over tasks in no release: they
 * get the option, then are archived with the rest. A sprint takes none.
 *
 * It is a member's, and an agent's. A member may archive every task of the
 * column one by one, so a guard here would only keep an agent from doing fast
 * what it may do slowly, and the agent that deployed is the one that knows the
 * release is out. Unship is the admin's: it throws the shipped day away, so
 * the option routes keep `adminOnly` for `shippedAt`, and a ship comes only
 * through here.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { optionId } = await ctx.params;
  const owner = await optionPropertyId(optionId);
  if (!owner) throw new HttpError(404, "Option not found.");
  const { projectId, propertyId } = owner;
  const { user, membership } = await guard(projectId);
  // A ship archives every task that is over, so it asks both switches.
  mayOnly(user, membership, "ship", "archive");

  const input = await body<{ rest?: unknown; strays?: unknown }>(req);
  const read = readShipRest(input);
  if ("error" in read) throw new HttpError(400, read.error);
  const { rest } = read;
  const strays = readShipStrays(input);

  const { answer, ring } = await withProjectLock(projectId, (tx) =>
    shipOptionIn(tx, { projectId, propertyId, optionId, rest, strays, actorId: user.id }),
  );

  await ring();
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json(answer);
});
