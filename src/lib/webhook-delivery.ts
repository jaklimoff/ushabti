import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK_KINDS, type WebhookKind, type WebhookPayload } from "./types";

/**
 * What one delivery is: the doorbell it carries, how it is signed, and when
 * it is tried again.
 *
 * Nothing here reads the database and nothing here reads the clock — the
 * moment is an argument — so a unit test drives the whole rule, and a
 * receiver's own check can be written from the same two functions.
 */

/** How long the sender waits for a receiver before it gives up on a try. */
export const SEND_TIMEOUT_MS = 5_000;

/**
 * The gaps between tries. The first try goes at once, so four tries in all:
 * now, a minute later, five minutes later, half an hour later.
 *
 * A receiver that is being restarted is back inside a minute; one that is
 * being deployed is back inside half an hour. After that the delivery is old
 * news, and the receiver reads the feed to catch up, which is what the feed
 * is for.
 */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

/** Four tries: the first, and one for each gap above. */
export const MAX_TRIES = RETRY_DELAYS_MS.length + 1;

/** How many deliveries one webhook keeps. Enough to read, not an audit. */
export const KEEP_DELIVERIES = 20;

/** A receiver refuses a body signed longer ago than this. */
export const SIGNATURE_WINDOW_SECONDS = 300;

/**
 * When to try again, having made `tries` of them, or null when it is over.
 *
 * It counts the tries that happened rather than the ones that are left, so a
 * row that was written by an older version of this list still lands on an
 * answer instead of retrying for ever.
 */
export function nextTryAfter(tries: number, now: Date): Date | null {
  const gap = RETRY_DELAYS_MS[tries - 1];
  if (gap === undefined) return null;
  return new Date(now.getTime() + gap);
}

/**
 * The signature of one body, as `sha256=<hex>`.
 *
 * The string signed is `timestamp + "." + body`, so a body that is replayed
 * an hour later does not carry a signature an hour old that still matches.
 * The receiver builds the same string and compares.
 */
export function sign(secret: string, timestamp: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Whether a signature is this body's, in constant time.
 *
 * It is here so that the test a receiver copies is the code that signs, and
 * `docs/webhooks.md` is ten lines of the same two calls.
 */
export function verify(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const wanted = Buffer.from(sign(secret, timestamp, body));
  const given = Buffer.from(signature);
  if (wanted.length !== given.length) return false;
  return timingSafeEqual(wanted, given);
}

/**
 * The kinds a webhook rings for, read afresh.
 *
 * Nothing rewrites a webhook, so a saved list can name a word this version no
 * longer writes. It is thrown away on the way out, exactly as a filter rule
 * naming a deleted property is. An empty list means every kind.
 */
export function readKinds(raw: unknown): WebhookKind[] {
  if (!Array.isArray(raw)) return [];
  const known = raw.filter((k): k is WebhookKind =>
    (WEBHOOK_KINDS as readonly string[]).includes(k as string),
  );
  return [...new Set(known)];
}

/** Whether this webhook rings for this feed line. No list means every kind. */
export function rings(kinds: WebhookKind[], kind: string): boolean {
  return kinds.length === 0 || (kinds as readonly string[]).includes(kind);
}

/** The headers one delivery carries. The body is signed, never the headers. */
export function deliveryHeaders(
  payload: WebhookPayload,
  secret: string,
  body: string,
  now: Date,
): Record<string, string> {
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  return {
    "content-type": "application/json",
    "x-ushabti-delivery": payload.delivery,
    "x-ushabti-timestamp": timestamp,
    "x-ushabti-signature": sign(secret, timestamp, body),
  };
}
