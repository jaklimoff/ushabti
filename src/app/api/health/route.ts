import { sql } from "drizzle-orm";
import { db } from "@/db";

/*
 * Open on purpose, with no guard(): Docker, Kubernetes and an uptime monitor
 * call it with no session and no token. So it says only whether the database
 * answers, and names no project, user or count.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { ok: false, error: "The database does not answer." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
