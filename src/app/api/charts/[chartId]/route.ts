import { eq } from "drizzle-orm";
import { db } from "@/db";
import { charts } from "@/db/schema";
import { json, route } from "@/lib/api";
import { ownChart } from "@/lib/charts-load";

type Ctx = { params: Promise<{ chartId: string }> };

/** The chart goes. The tasks and the feed it counted stay. */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const { chart } = await ownChart((await ctx.params).chartId);
  await db.delete(charts).where(eq(charts.id, chart.id));
  return json({ ok: true });
});
