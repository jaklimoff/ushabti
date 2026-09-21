import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { body, guard, json, ownerOnly, route } from "@/lib/api";
import { loadWebhooks, mintSecret, webhookUrl } from "@/lib/webhooks";
import { readKinds } from "@/lib/webhook-delivery";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * A webhook is a URL and a secret, which is access to the board by another
 * road. So every route here is `ownerOnly` — the read one too. A member who
 * could read the list would have the endpoint the board rings; a member who
 * could write one would point it at their own.
 */

export const GET = route<Ctx>(async (_req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "see the webhooks of this project");
  return json({ webhooks: await loadWebhooks(projectId) });
});

/**
 * Makes one, and answers the only copy of its secret.
 *
 * The secret is stored whole, because the server signs every body with it,
 * but it is shown once all the same: a readable secret on a settings page is
 * one screenshot away from a leak. After this the page shows a prefix, and
 * the way to another one is **Roll the secret**.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "add a webhook");

  const input = await body<{ url?: string; kinds?: unknown }>(req);
  const url = webhookUrl(input.url);
  const minted = mintSecret();

  const [row] = await db
    .insert(webhooks)
    .values({
      projectId,
      url,
      secret: minted.secret,
      prefix: minted.prefix,
      kinds: readKinds(input.kinds),
      createdBy: user.id,
    })
    .returning({ id: webhooks.id, createdAt: webhooks.createdAt });

  return json(
    {
      webhook: {
        id: row.id,
        url,
        prefix: minted.prefix,
        kinds: readKinds(input.kinds),
        active: true,
        createdAt: row.createdAt.toISOString(),
        lastDelivery: null,
      },
      /** Readable here and never again. */
      secret: minted.secret,
    },
    201,
  );
});
