import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers } from "@/db/schema";
import { fail, humanOnly } from "@/lib/api";
import { HttpError, requireActor } from "@/lib/auth";
import { isPresence, subscribe } from "@/lib/events";
import { LISTEN_TOUCH_MS } from "@/lib/presence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function memberOf(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  return new Set(rows.map((r) => r.projectId));
}

/**
 * Home's doorbell: one connection for every project the person is a member
 * of, so a person with twenty projects does not hold twenty sockets. It rings
 * with a project id and nothing else, and Home answers by reading itself
 * again.
 *
 * A person only. An agent's token opens one project, and that project has a
 * stream of its own.
 *
 * Who the person is a member of is read again on every ping, so a project
 * they join or leave while Home is open starts or stops ringing within one,
 * and the change itself rings once, because Home draws the list of projects.
 * Presence is not sent: Home draws nobody's open task.
 */
export async function GET(req: Request) {
  let userId: string;
  try {
    const user = await requireActor();
    humanOnly(user);
    userId = user.id;
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message);
    throw err;
  }

  const encoder = new TextEncoder();
  const unsubscribes = new Map<string, () => void>();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    for (const off of unsubscribes.values()) off();
    unsubscribes.clear();
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: string) => {
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          /* the client went away */
        }
      };
      const ring = (projectId: string) =>
        send(`event: change\ndata: ${JSON.stringify({ projectId })}\n\n`);

      /* Brings the subscriptions in line with the memberships, and says
         whether they moved. */
      const follow = async (): Promise<string | null> => {
        const ids = await memberOf(userId);
        let moved: string | null = null;
        for (const [id, off] of unsubscribes) {
          if (ids.has(id)) continue;
          off();
          unsubscribes.delete(id);
          moved = id;
        }
        for (const id of ids) {
          if (unsubscribes.has(id)) continue;
          const off = await subscribe(id, (event) => {
            if (!isPresence(event)) ring(event.projectId);
          });
          if (closed) {
            off();
            continue;
          }
          unsubscribes.set(id, off);
          moved = id;
        }
        return moved;
      };

      send(`retry: 3000\n\n`);
      await follow();
      if (closed) return;

      // Ready goes out after the subscriptions, so that a client which reads
      // on `ready` cannot miss what happens in between.
      send(`event: ready\ndata: {}\n\n`);

      heartbeat = setInterval(() => {
        send(`: ping\n\n`);
        void follow()
          .then((moved) => {
            if (moved && !closed) ring(moved);
          })
          .catch(() => {
            /* the next ping tries again */
          });
      }, LISTEN_TOUCH_MS);

      req.signal.addEventListener("abort", () => {
        close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
