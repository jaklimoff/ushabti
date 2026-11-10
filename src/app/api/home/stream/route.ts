import { fail, humanOnly } from "@/lib/api";
import { HttpError, requireActor } from "@/lib/auth";
import { isPresence } from "@/lib/events";
import { followMemberships, type Following } from "@/lib/following";
import { LISTEN_TOUCH_MS } from "@/lib/presence";
import { holdStream, isStopping } from "@/lib/shutdown";
import { holderOf, stillAllowed, type Holder } from "@/lib/stream-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
 * Presence is not sent: Home draws nobody's open task. The session or token
 * is checked again on every ping too, and the stream closes once it is gone.
 */
export async function GET(req: Request) {
  /* A server that is stopping sends the browser to the next one. */
  if (isStopping()) return fail(503, "The server is restarting.");
  let userId: string;
  let holder: Holder;
  try {
    const user = await requireActor();
    humanOnly(user);
    userId = user.id;
    holder = await holderOf(user);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message);
    throw err;
  }

  const encoder = new TextEncoder();
  let following: Following | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let release: (() => void) | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    release?.();
    if (heartbeat) clearInterval(heartbeat);
    following?.close();
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
      const end = () => {
        close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const ring = (projectId: string) =>
        send(`event: change\ndata: ${JSON.stringify({ projectId })}\n\n`);

      /* First, so an abort during the await below still closes what it made. */
      if (req.signal.aborted) return end();
      req.signal.addEventListener("abort", end);
      /* A stop ends it, so the server is not held open by a stream. */
      release = holdStream(end);

      const follows = followMemberships(userId, (event) => {
        if (!isPresence(event)) ring(event.projectId);
      });
      following = follows;

      send(`retry: 3000\n\n`);
      await follows.follow();
      if (closed) return;

      // Ready goes out after the subscriptions, so that a client which reads
      // on `ready` cannot miss what happens in between.
      send(`event: ready\ndata: {}\n\n`);

      heartbeat = setInterval(() => {
        send(`: ping\n\n`);
        void stillAllowed(holder)
          .then((ok) => {
            if (!ok) end();
          })
          .catch(() => {
            /* a database that does not answer is not a no; the next ping asks */
          });
        void follows
          .follow()
          .then((moved) => {
            if (moved && !closed) ring(moved);
          })
          .catch(() => {
            /* the next ping tries again */
          });
      }, LISTEN_TOUCH_MS);
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      /* The socket goes with the stream. Kept alive, an ended stream left it
         idle, and a stopping server waited for it until its deadline. */
      Connection: "close",
      "X-Accel-Buffering": "no",
    },
  });
}
