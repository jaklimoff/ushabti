import { fail, guard } from "@/lib/api";
import { markListening } from "@/lib/agents";
import { HttpError } from "@/lib/auth";
import { publish, subscribe } from "@/lib/events";
import { LISTEN_TOUCH_MS } from "@/lib/presence";

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
 */
export async function GET(req: Request, ctx: Ctx) {
  const { projectId } = await ctx.params;
  let tokenId: string | undefined;
  try {
    const { user } = await guard(projectId);
    // An agent holding this open hears a new task. That is what "listening"
    // means on the board, so the stream is what says it.
    if (user.kind === "agent") tokenId = user.tokenId;
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message);
    throw err;
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  /* The board draws who is listening, so it has to hear when that changes.
     The lease covers a crash; this covers everything else at once. */
  const listening = async (on: boolean) => {
    if (!tokenId) return;
    await markListening(tokenId, on);
    await publish({ projectId, scope: "project" });
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    void listening(false);
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

      send(`retry: 3000\n\n`);

      unsubscribe = await subscribe(projectId, (event) => {
        send(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // Ready goes out after the subscription, so that a client which reads
      // what it missed on `ready` cannot miss what happens in between.
      send(`event: ready\ndata: {}\n\n`);
      void listening(true);

      heartbeat = setInterval(() => {
        send(`: ping\n\n`);
        if (tokenId) void markListening(tokenId, true);
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
