import { fail, guard } from "@/lib/api";
import { markListening } from "@/lib/agents";
import { kickAskMail } from "@/lib/ask-sender";
import { HttpError } from "@/lib/auth";
import { isPresence, publish, subscribe } from "@/lib/events";
import { followMemberships, type Following } from "@/lib/following";
import { LISTEN_TOUCH_MS, readClientId } from "@/lib/presence";
import { holdStream, isStopping } from "@/lib/shutdown";
import { holderOf, stillAllowed, type Holder } from "@/lib/stream-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Server-sent events. One connection per open board, and one per agent that
 * waits for work.
 *
 * An event is a doorbell, not a message: it says that something changed and
 * where. A browser answers by reading the board; an agent answers by reading
 * the activity feed after the last line it saw. Neither trusts the event to
 * carry the change, because SSE drops whatever happens while the socket is
 * down, and the feed does not.
 *
 * A `change` may name an agent whose name changed, as `renamed`. It is a
 * hint to read `/api/agent/me` again and never carries the name. A watcher
 * that misses it reads its name again on the next `ready`.
 *
 * `presence` is the one event that carries its data: which task a person's
 * tab has open. Nothing stores it, so there is nothing to read instead. An
 * agent receives it too and ignores it, as it ignores any event it does not
 * know.
 *
 * A person in the room also hears `elsewhere`, carrying only `{ projectId }`,
 * when anything but presence happens in another project they are a member
 * of. It lets a page say live which projects have work going on without a
 * second socket per tab. The board does not read itself on it. Memberships
 * are followed as Home's stream follows them, re-read on every ping, and a
 * project joined or left rings once. An agent never gets `elsewhere`: its
 * token opens one project.
 *
 * The session or token and the membership are checked again on every ping,
 * and the stream closes when either is gone: a member who was removed, or an
 * agent whose token was revoked, must stop hearing rings and presence.
 */
export async function GET(req: Request, ctx: Ctx) {
  /* A server that is stopping sends the browser to the next one. */
  if (isStopping()) return fail(503, "The server is restarting.");
  const { projectId } = await ctx.params;
  let tokenId: string | undefined;
  let userId = "";
  /* An EventSource cannot set a header, so the tab names itself here. */
  const clientId = readClientId(new URL(req.url).searchParams.get("client"));
  let human = false;
  let holder: Holder;
  try {
    const { user } = await guard(projectId);
    userId = user.id;
    holder = await holderOf(user);
    // A script on a personal token is not in the room, so it says no goodbye.
    human = user.kind === "human" && !user.personalTokenId;
    // An agent holding this open hears a new task. That is what "listening"
    // means on the board, so the stream is what says it.
    if (user.kind === "agent") tokenId = user.tokenId;
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message);
    throw err;
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let elsewhere: Following | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let release: (() => void) | null = null;

  /* The board draws who is listening, so it has to hear when that changes.
     The lease covers a crash; this covers everything else at once. */
  const listening = async (on: boolean) => {
    if (!tokenId) return;
    await markListening(tokenId, on);
    await publish({ projectId, scope: "project" });
  };

  /* A tab that closes the board says goodbye through its stream, so its face
     goes at once. The lease covers a crash; this covers a normal close. */
  const leave = async () => {
    if (!human || !clientId) return;
    await publish({ projectId, kind: "presence", clientId, userId, taskId: null, field: null });
  };

  const close = () => {
    if (closed) return;
    closed = true;
    release?.();
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    elsewhere?.close();
    void listening(false);
    void leave();
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

      /* First, so an abort during any await below still closes everything
         that await goes on to make. */
      if (req.signal.aborted) return end();
      req.signal.addEventListener("abort", end);
      /* A stop ends it, so the server is not held open by a stream. */
      release = holdStream(end);

      send(`retry: 3000\n\n`);

      const off = await subscribe(projectId, (event) => {
        const name = isPresence(event) ? "presence" : "change";
        send(`event: ${name}\ndata: ${JSON.stringify(event)}\n\n`);
      });
      if (closed) return off();
      unsubscribe = off;
      const ringElsewhere = (id: string) =>
        send(`event: elsewhere\ndata: ${JSON.stringify({ projectId: id })}\n\n`);
      if (human) {
        elsewhere = followMemberships(
          userId,
          (event) => {
            if (!isPresence(event)) ringElsewhere(event.projectId);
          },
          projectId,
        );
        await elsewhere.follow();
      }
      if (closed) return;

      // Ready goes out after the subscription, so that a client which reads
      // what it missed on `ready` cannot miss what happens in between.
      send(`event: ready\ndata: {}\n\n`);
      void listening(true);

      heartbeat = setInterval(() => {
        send(`: ping\n\n`);
        void stillAllowed(holder, projectId)
          .then((ok) => {
            if (!ok) end();
          })
          .catch(() => {
            /* a database that does not answer is not a no; the next ping asks */
          });
        if (tokenId) void markListening(tokenId, true);
        void elsewhere
          ?.follow()
          .then((moved) => {
            if (moved && !closed) ringElsewhere(moved);
          })
          .catch(() => {
            /* the next ping tries again */
          });
        /* A watcher holds this open while nobody has the board open, so the
           ping is what looks for an ask that is owed its email. */
        kickAskMail();
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
