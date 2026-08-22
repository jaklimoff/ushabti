import { fail, guard } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { subscribe } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string }> };

/** Server-sent events. One connection per open board. */
export async function GET(req: Request, ctx: Ctx) {
  const { projectId } = await ctx.params;
  try {
    await guard(projectId);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message);
    throw err;
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

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
      send(`event: ready\ndata: {}\n\n`);

      unsubscribe = await subscribe(projectId, (event) => {
        send(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
      });

      heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);

      req.signal.addEventListener("abort", () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
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
