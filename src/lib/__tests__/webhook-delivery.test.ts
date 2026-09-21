import { describe, expect, it } from "vitest";
import {
  deliveryHeaders,
  MAX_TRIES,
  nextTryAfter,
  readKinds,
  rings,
  RETRY_DELAYS_MS,
  sign,
  verify,
} from "../webhook-delivery";
import type { WebhookPayload } from "../types";

/**
 * The known answer. A receiver in any language can copy these four values and
 * check its own code against them before it trusts a single delivery — which
 * is the whole reason the numbers are written out rather than computed here.
 */
const KNOWN = {
  secret: "ushs_a-known-secret-for-the-test",
  timestamp: "1774000000",
  body:
    '{"delivery":"9d2d9d6e-9a6f-4f63-9b1e-6b2b0b6a4c11",' +
    '"projectId":"2f1a7c2e-5f0c-4d4a-9a2e-2b9a3c4d5e6f",' +
    '"projectKey":"USH","kind":"comment",' +
    '"taskId":"7c1b9a2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d","taskKey":"USH-31",' +
    '"at":"2026-03-17T09:46:40.000Z"}',
  signature: "sha256=861a870d23c4a8089c8af6c498dd30e1bafb67b299080feb2ec792de5088f70d",
};

describe("the signature", () => {
  it("is this exact string for this exact body", () => {
    expect(sign(KNOWN.secret, KNOWN.timestamp, KNOWN.body)).toBe(KNOWN.signature);
  });

  it("accepts its own and refuses everything else", () => {
    expect(verify(KNOWN.secret, KNOWN.timestamp, KNOWN.body, KNOWN.signature)).toBe(true);
    // Another secret, another moment, another body: each one on its own is enough.
    expect(verify("ushs_another", KNOWN.timestamp, KNOWN.body, KNOWN.signature)).toBe(false);
    expect(verify(KNOWN.secret, "1774000001", KNOWN.body, KNOWN.signature)).toBe(false);
    expect(verify(KNOWN.secret, KNOWN.timestamp, KNOWN.body + " ", KNOWN.signature)).toBe(false);
  });

  it("refuses a signature of another length without throwing", () => {
    // timingSafeEqual throws on two buffers of different sizes, so the length
    // is answered before it is asked. A truncated header must read as wrong,
    // not as a 500.
    expect(verify(KNOWN.secret, KNOWN.timestamp, KNOWN.body, "sha256=00")).toBe(false);
    expect(verify(KNOWN.secret, KNOWN.timestamp, KNOWN.body, "")).toBe(false);
  });

  it("covers the moment, so a body cannot be replayed with its old signature", () => {
    const first = sign(KNOWN.secret, "1774000000", KNOWN.body);
    const later = sign(KNOWN.secret, "1774003600", KNOWN.body);
    expect(first).not.toBe(later);
  });

  it("is what the headers carry", () => {
    const payload = JSON.parse(KNOWN.body) as WebhookPayload;
    const headers = deliveryHeaders(
      payload,
      KNOWN.secret,
      KNOWN.body,
      new Date(Number(KNOWN.timestamp) * 1000),
    );
    expect(headers["x-ushabti-timestamp"]).toBe(KNOWN.timestamp);
    expect(headers["x-ushabti-signature"]).toBe(KNOWN.signature);
    expect(headers["x-ushabti-delivery"]).toBe(payload.delivery);
    expect(headers["content-type"]).toBe("application/json");
  });
});

describe("the retry schedule", () => {
  const now = new Date("2026-03-17T09:00:00.000Z");
  const after = (tries: number) => nextTryAfter(tries, now)?.toISOString() ?? null;

  it("is a minute, then five, then half an hour", () => {
    expect(after(1)).toBe("2026-03-17T09:01:00.000Z");
    expect(after(2)).toBe("2026-03-17T09:05:00.000Z");
    expect(after(3)).toBe("2026-03-17T09:30:00.000Z");
  });

  it("gives up after four tries", () => {
    expect(after(4)).toBeNull();
    expect(MAX_TRIES).toBe(4);
    expect(RETRY_DELAYS_MS).toHaveLength(MAX_TRIES - 1);
  });

  it("gives up for a count no list ever had", () => {
    // A row written by an older version of the list must land on an answer
    // rather than retry for ever. Zero is not a case a caller has — the queue
    // writes the first moment itself — and it answers the same way.
    expect(after(9)).toBeNull();
    expect(after(0)).toBeNull();
  });
});

describe("which kinds ring", () => {
  it("throws away a word nobody knows, and keeps each one once", () => {
    expect(readKinds(["comment", "banana", "comment", "run"])).toEqual(["comment", "run"]);
    expect(readKinds("comment")).toEqual([]);
    expect(readKinds(null)).toEqual([]);
  });

  it("rings for everything when nothing is named", () => {
    expect(rings([], "comment")).toBe(true);
    expect(rings([], "reset")).toBe(true);
  });

  it("rings only for what is named", () => {
    expect(rings(["comment"], "comment")).toBe(true);
    expect(rings(["comment"], "run")).toBe(false);
  });
});
