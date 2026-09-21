import { guard, json, ownerOnly, route } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { countDeliveries, webhookProjectId } from "@/lib/webhooks";

type Ctx = { params: Promise<{ projectId: string; webhookId: string }> };

/**
 * How many deliveries go with this webhook if it is deleted.
 *
 * It is the number the delete row names, and it is asked when that row is
 * pressed, exactly as a property's value count is — so the page read pays for
 * nothing an owner looks at once.
 *
 * `ownerOnly` like the rest of this folder: a member cannot see that a
 * webhook exists, so it must not be able to count one either.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { projectId, webhookId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "see the webhooks of this project");

  const belongsTo = await webhookProjectId(webhookId);
  if (!belongsTo || belongsTo !== projectId) throw new HttpError(404, "Webhook not found.");

  return json({ deliveries: await countDeliveries(webhookId) });
});
