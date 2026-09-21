import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { db } from "@/db";
import { projects, tasks, webhookDeliveries, webhooks } from "@/db/schema";
import { mintToken } from "./agents";
import {
  isPrivateHost,
  isPrivateIp,
  privateAddressesAllowed,
  privateSentence,
  refuseAddress,
} from "./webhook-address";
import { HttpError } from "./auth";
import { str } from "./api";
import {
  deliveryHeaders,
  KEEP_DELIVERIES,
  MAX_TRIES,
  nextTryAfter,
  readKinds,
  rings,
  SEND_TIMEOUT_MS,
} from "./webhook-delivery";
import type {
  WebhookDeliveryDTO,
  WebhookDeliveryState,
  WebhookDTO,
  WebhookKind,
  WebhookPayload,
} from "./types";

/**
 * The webhooks of a project, and the sender that rings them.
 *
 * The shape of one delivery — its body, its signature and its retry schedule
 * — is in `webhook-delivery.ts`, which reads neither the database nor the
 * clock. This module is the table and the network.
 */

/** A webhook secret says what it is, as an agent token and a reset link do. */
export const WEBHOOK_SECRET_PREFIX = "ushs_";

/** How many due deliveries one pass of the sender takes at a time. */
const BATCH = 20;

/** How many passes one drain makes before it leaves the rest to the next. */
const MAX_PASSES = 20;

export type MintedSecret = { secret: string; prefix: string };

export function mintSecret(): MintedSecret {
  const minted = mintToken(WEBHOOK_SECRET_PREFIX);
  return { secret: minted.token, prefix: minted.prefix };
}

/* ------------------------------------------------------------------ */
/* Queueing                                                            */
/* ------------------------------------------------------------------ */

/** One feed line, as `logActivity` has just written it. */
export type Rung = {
  projectId: string;
  taskId: string | null;
  kind: string;
  at: Date;
};

/**
 * Writes one queued delivery for every webhook these feed lines ring.
 *
 * It is called by `logActivity` after the activity row is in, and it touches
 * no network at all: a dead endpoint costs this project one INSERT and
 * nothing else. A project with no webhook pays one indexed read that answers
 * nothing, which is the common case and has to stay cheap.
 */
export async function queueWebhooks(rung: Rung[]): Promise<void> {
  const byProject = new Map<string, Rung[]>();
  for (const line of rung) {
    const list = byProject.get(line.projectId) ?? [];
    list.push(line);
    byProject.set(line.projectId, list);
  }
  for (const [projectId, lines] of byProject) await queueForProject(projectId, lines);
}

async function queueForProject(projectId: string, rung: Rung[]): Promise<void> {
  const hooks = await db
    .select({
      id: webhooks.id,
      kinds: webhooks.kinds,
      projectKey: projects.key,
    })
    .from(webhooks)
    .innerJoin(projects, eq(projects.id, webhooks.projectId))
    .where(and(eq(webhooks.projectId, projectId), eq(webhooks.active, true)));

  if (hooks.length === 0) return;

  /* A key is the project's prefix and the task's number, and neither is on
     the activity row. One read answers for every line of this call. */
  const taskIds = [...new Set(rung.map((r) => r.taskId).filter((id): id is string => id !== null))];
  const numbers = new Map<string, number>();
  if (taskIds.length) {
    const rows = await db
      .select({ id: tasks.id, number: tasks.number })
      .from(tasks)
      .where(inArray(tasks.id, taskIds));
    for (const row of rows) numbers.set(row.id, row.number);
  }

  const now = new Date();
  const rows: (typeof webhookDeliveries.$inferInsert)[] = [];

  for (const hook of hooks) {
    const kinds = readKinds(hook.kinds);
    for (const line of rung) {
      if (!rings(kinds, line.kind)) continue;
      const number = line.taskId === null ? undefined : numbers.get(line.taskId);
      const id = randomUUID();
      const payload: WebhookPayload = {
        delivery: id,
        projectId,
        projectKey: hook.projectKey,
        kind: line.kind,
        taskId: line.taskId,
        taskKey: number === undefined ? null : `${hook.projectKey}-${number}`,
        at: line.at.toISOString(),
      };
      /* Due now. The first try is immediate; the gaps are for the retries. */
      rows.push({ id, webhookId: hook.id, body: payload, nextTryAt: now });
    }
  }

  if (rows.length === 0) return;
  await db.insert(webhookDeliveries).values(rows);
  await sweepDeliveries([...new Set(rows.map((r) => r.webhookId))]);
}

/**
 * Keeps the newest deliveries of a webhook and drops the rest.
 *
 * On the write, with no timer, exactly as a new reset link drops the spent
 * links of that account: one row arrives per ring, and nothing ever took one
 * away. A delivery that still has a try left is never swept, however old it
 * is — the sweep is for the record, not for the queue.
 *
 * One statement for every webhook that rang, because this is on the write. A
 * SELECT and a DELETE each cost the writer two round-trips per webhook, so a
 * project with five webhooks paid ten of them for housekeeping. The window
 * numbers each webhook's deliveries newest first, and everything past the
 * twentieth goes.
 */
async function sweepDeliveries(hookIds: string[]): Promise<void> {
  if (hookIds.length === 0) return;

  await db.execute(sql`
    delete from ${webhookDeliveries}
    using (
      select id,
             row_number() over (partition by webhook_id order by created_at desc) as place
      from ${webhookDeliveries}
      where ${inArray(webhookDeliveries.webhookId, hookIds)}
    ) as ranked
    where ${webhookDeliveries.id} = ranked.id
      and ranked.place > ${KEEP_DELIVERIES}
      and ${webhookDeliveries.nextTryAt} is null
  `);
}

/** Queues one delivery by hand, for **Send a test**. */
export async function queueTest(webhookId: string): Promise<void> {
  const [hook] = await db
    .select({ id: webhooks.id, projectId: webhooks.projectId, projectKey: projects.key })
    .from(webhooks)
    .innerJoin(projects, eq(projects.id, webhooks.projectId))
    .where(eq(webhooks.id, webhookId))
    .limit(1);
  if (!hook) return;

  const id = randomUUID();
  const payload: WebhookPayload = {
    delivery: id,
    projectId: hook.projectId,
    projectKey: hook.projectKey,
    /* Its own word, so a receiver can answer a test without reading the feed
       for a line that was never written. */
    kind: "test",
    taskId: null,
    taskKey: null,
    at: new Date().toISOString(),
  };
  await db
    .insert(webhookDeliveries)
    .values({ id, webhookId: hook.id, body: payload, nextTryAt: new Date() });
  await sweepDeliveries([hook.id]);
}

/* ------------------------------------------------------------------ */
/* The sender                                                          */
/* ------------------------------------------------------------------ */

/**
 * One drain at a time in this process.
 *
 * It is a flag rather than a lock in the database, for the same reason the
 * rate limit counts in memory: Ushabti runs as one server. A second process
 * would drain the same queue, and a delivery could go out twice — which the
 * `delivery` id on the body is there to let a receiver answer.
 */
const globalForSender = globalThis as unknown as { __ushabtiDraining?: boolean };

/**
 * Starts a drain and does not wait for it.
 *
 * Nothing that writes may await the network, so this is the only way the
 * sender is ever started from a write. It is safe to call on every change:
 * a drain already running is left to finish, and it will see the row that
 * was just queued.
 */
export function kickSender(): void {
  if (globalForSender.__ushabtiDraining) return;
  void drainWebhooks().catch(() => {
    // A sender that throws must never reach the write that started it.
  });
}

/** Sends every delivery that is due. Awaited only by the sender's own tests. */
export async function drainWebhooks(now: () => Date = () => new Date()): Promise<void> {
  if (globalForSender.__ushabtiDraining) return;
  globalForSender.__ushabtiDraining = true;
  try {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const due = await db
        .select({
          id: webhookDeliveries.id,
          body: webhookDeliveries.body,
          tries: webhookDeliveries.tries,
          url: webhooks.url,
          secret: webhooks.secret,
        })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
        .where(
          and(
            isNull(webhookDeliveries.deliveredAt),
            isNotNull(webhookDeliveries.nextTryAt),
            lte(webhookDeliveries.nextTryAt, now()),
            /* Turning a webhook off has to stop it at once, including the
               deliveries already in the queue behind it. Without this a hook
               switched off in the middle of a retry schedule still rang, up
               to half an hour later. */
            eq(webhooks.active, true),
          ),
        )
        .orderBy(asc(webhookDeliveries.nextTryAt))
        .limit(BATCH);

      if (due.length === 0) return;
      for (const row of due) await sendOne(row, now());
    }
  } finally {
    globalForSender.__ushabtiDraining = false;
  }
}

type DueRow = {
  id: string;
  body: unknown;
  tries: number;
  url: string;
  secret: string;
};

/**
 * Whether this address may be called, asked again at the moment of the call.
 *
 * The route already refused a private literal when the URL was saved. This is
 * the harder half: a name is resolved here, so a host that answered publicly
 * on Monday and points at 10.0.0.5 today is refused on the try rather than on
 * the save. It answers a sentence, or null.
 */
async function refuseAtSendTime(url: string, allowPrivate: boolean): Promise<string | null> {
  const said = refuseAddress(url, allowPrivate);
  if (said) return said;
  if (allowPrivate) return null;

  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  // A literal was already answered above; only a name is left to resolve.
  if (isPrivateHost(host) || isPrivateIp(host)) return null;

  try {
    const answers = await lookup(host, { all: true });
    const inside = answers.find((a) => isPrivateIp(a.address));
    if (inside) return privateSentence(`${host} (${inside.address})`);
  } catch {
    /* A name that does not resolve is not a refusal. The try itself will fail
       in a moment and say so in the words the resolver used. */
  }
  return null;
}

/** One try. It always writes an answer, so a row is never due twice over. */
async function sendOne(row: DueRow, now: Date): Promise<void> {
  const payload = row.body as WebhookPayload;
  const body = JSON.stringify(payload);
  const tries = row.tries + 1;

  const refused = await refuseAtSendTime(row.url, privateAddressesAllowed());
  if (refused) {
    /* No retry: the answer would be the same in half an hour, and each try
       would be another request nobody may make. */
    await db
      .update(webhookDeliveries)
      .set({ tries, code: null, error: refused, nextTryAt: null })
      .where(eq(webhookDeliveries.id, row.id));
    return;
  }

  try {
    const res = await fetch(row.url, {
      method: "POST",
      headers: deliveryHeaders(payload, row.secret, body, now),
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      redirect: "error",
    });
    if (res.ok) {
      await db
        .update(webhookDeliveries)
        .set({ tries, code: res.status, error: null, deliveredAt: new Date(), nextTryAt: null })
        .where(eq(webhookDeliveries.id, row.id));
      return;
    }
    await failed(row.id, tries, res.status, null, now);
  } catch (err) {
    await failed(row.id, tries, null, reasonOf(err), now);
  }
}

async function failed(
  id: string,
  tries: number,
  code: number | null,
  error: string | null,
  now: Date,
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({ tries, code, error, nextTryAt: tries >= MAX_TRIES ? null : nextTryAfter(tries, now) })
    .where(eq(webhookDeliveries.id, id));
}

/**
 * Why a try failed, in the words a person can act on.
 *
 * `fetch` says "fetch failed" for everything from a refused port to a bad
 * certificate, and puts the answer in the cause. A line that says
 * ECONNREFUSED tells the owner the port is shut; "fetch failed" tells nobody
 * anything.
 */
function reasonOf(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return `no answer in ${SEND_TIMEOUT_MS / 1000} s`;
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (code) return code;
    return err.message.slice(0, 200);
  }
  return String(err).slice(0, 200);
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function stateOf(row: { deliveredAt: Date | null; nextTryAt: Date | null }): WebhookDeliveryState {
  if (row.deliveredAt) return "delivered";
  return row.nextTryAt ? "waiting" : "failed";
}

/** The webhooks of a project, each with the delivery the page shows. */
export async function loadWebhooks(projectId: string): Promise<WebhookDTO[]> {
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.projectId, projectId))
    .orderBy(asc(webhooks.createdAt));

  if (rows.length === 0) return [];

  /* The newest delivery of each webhook, picked per webhook rather than off
     one ordered page: forty deliveries of one busy hook would otherwise take
     the whole answer and leave the quiet ones looking as if they never rang. */
  const latest = await db
    .selectDistinctOn([webhookDeliveries.webhookId])
    .from(webhookDeliveries)
    .where(
      inArray(
        webhookDeliveries.webhookId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(webhookDeliveries.webhookId, desc(webhookDeliveries.createdAt));

  const byHook = new Map(latest.map((d) => [d.webhookId, d]));

  return rows.map((row) => {
    const last = byHook.get(row.id);
    const lastDelivery: WebhookDeliveryDTO | null = last
      ? {
          id: last.id,
          state: stateOf(last),
          code: last.code,
          error: last.error,
          tries: last.tries,
          at: last.createdAt.toISOString(),
        }
      : null;
    return {
      id: row.id,
      url: row.url,
      prefix: row.prefix,
      kinds: readKinds(row.kinds) as WebhookKind[],
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      lastDelivery,
    };
  });
}

/** The project a webhook belongs to, or null. The routes guard on it. */
export async function webhookProjectId(webhookId: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: webhooks.projectId })
    .from(webhooks)
    .where(eq(webhooks.id, webhookId))
    .limit(1);
  return row?.projectId ?? null;
}

/** How many deliveries a webhook has, for the sentence the delete row asks. */
export async function countDeliveries(webhookId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId));
  return row?.count ?? 0;
}

/**
 * A URL the sender can actually post to. Nothing else is a webhook.
 *
 * It sits here rather than in the route because both routes read one, and
 * because a route file may export nothing but its methods. What counts as an
 * address is `webhook-address.ts`, which the sender asks again before it
 * calls one.
 */
export function webhookUrl(raw: unknown): string {
  const text = str(raw, "The URL", { max: 500 });
  const refused = refuseAddress(text, privateAddressesAllowed());
  if (refused) throw new HttpError(400, refused);
  return new URL(text).toString();
}
