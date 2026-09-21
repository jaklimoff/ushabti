import { eq } from "drizzle-orm";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { body, guard, json, ownerOnly, route } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { kickSender, mintSecret, queueTest, webhookProjectId, webhookUrl } from "@/lib/webhooks";
import { readKinds } from "@/lib/webhook-delivery";

type Ctx = { params: Promise<{ projectId: string; webhookId: string }> };

/**
 * The owner of the project this webhook belongs to, or a refusal.
 *
 * Who is asking is settled before anything is read. Looking the webhook up
 * first answered an anonymous caller `404` instead of `401`, which is both
 * the wrong answer and a way to ask whether an id exists without signing in.
 */
async function owner(projectId: string, webhookId: string) {
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "change a webhook");
  const belongsTo = await webhookProjectId(webhookId);
  if (!belongsTo || belongsTo !== projectId) throw new HttpError(404, "Webhook not found.");
}

/**
 * Changes the URL, the kinds or the on-off word, and rolls the secret.
 *
 * Rolling answers the new secret once, exactly as making the webhook did.
 * Nothing reads the old one again, and a receiver that has not been told the
 * new one starts refusing deliveries — which is what rolling a secret means.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { projectId, webhookId } = await ctx.params;
  await owner(projectId, webhookId);

  const input = await body<{
    url?: string;
    kinds?: unknown;
    active?: boolean;
    roll?: boolean;
  }>(req);
  const patch: Record<string, unknown> = {};

  if (input.url !== undefined) patch.url = webhookUrl(input.url);
  if (input.kinds !== undefined) patch.kinds = readKinds(input.kinds);
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw new HttpError(400, "On or off, nothing else.");
    patch.active = input.active;
  }

  if (input.roll) {
    const minted = mintSecret();
    await db
      .update(webhooks)
      .set({ ...patch, secret: minted.secret, prefix: minted.prefix })
      .where(eq(webhooks.id, webhookId));
    return json({ prefix: minted.prefix, secret: minted.secret });
  }

  if (Object.keys(patch).length === 0) return json({ ok: true });
  await db.update(webhooks).set(patch).where(eq(webhooks.id, webhookId));
  return json({ ok: true });
});

/**
 * **Send a test**: one delivery, queued like any other.
 *
 * It is queued rather than sent here on purpose. A route that waited for the
 * receiver would be the one place in the product where a click holds a
 * connection open for five seconds, and it would test a road no real ring
 * ever takes.
 */
export const POST = route<Ctx>(async (_req, ctx) => {
  const { projectId, webhookId } = await ctx.params;
  await owner(projectId, webhookId);
  await queueTest(webhookId);
  kickSender();
  return json({ ok: true }, 202);
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const { projectId, webhookId } = await ctx.params;
  await owner(projectId, webhookId);
  await db.delete(webhooks).where(eq(webhooks.id, webhookId));
  return json({ ok: true });
});
