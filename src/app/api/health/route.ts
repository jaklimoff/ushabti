import { sql } from "drizzle-orm";
import { db } from "@/db";
import { hearsChanges } from "@/lib/events";
import { version } from "../../../../package.json";

/*
 * Open on purpose, with no guard(): Docker, Kubernetes and an uptime monitor
 * call it with no session and no token. So it says only whether the database
 * answers, whether this process hears changes, and which release it runs, and
 * names no project, user or count.
 *
 * A process that does not hear changes still answers 200: LISTEN comes back
 * by itself, and a restart would drop every open stream for nothing. A
 * monitor that wants to know reads `listening`.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const listening = hearsChanges();
  try {
    await db.execute(sql`select 1`);
    return Response.json(
      { ok: true, listening, version },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, error: "The database does not answer.", listening, version },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
