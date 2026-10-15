import { db } from "@/db";
import { charts, chartSources } from "@/db/schema";
import { HttpError, requireActor } from "@/lib/auth";
import { body, humanOnly, json, route } from "@/lib/api";
import { CHART_TWICE, sameSources } from "@/lib/charts";
import { checkSources, chartsOf, readSources } from "@/lib/charts-load";
import { lockList } from "@/lib/membership";
import { rankAfter, rankSequence } from "@/lib/rank";

/** A new chart on Home: one option of one select in each of its projects. */
export const POST = route(async (req) => {
  const user = await requireActor();
  humanOnly(user);
  const sources = readSources(await body(req));
  await checkSources(sources);
  // Under the person's own lock, so two presses cannot both find no twin.
  const chart = await db.transaction(async (tx) => {
    await lockList(tx, user.id);
    const rows = await chartsOf(user.id, tx);
    if (rows.some((r) => sameSources(r.sources, sources))) throw new HttpError(409, CHART_TWICE);
    const [made] = await tx
      .insert(charts)
      .values({ userId: user.id, position: rankAfter(rows.at(-1)?.position) })
      .returning({ id: charts.id });
    const positions = rankSequence(sources.length);
    await tx
      .insert(chartSources)
      .values(sources.map((s, i) => ({ ...s, chartId: made.id, position: positions[i] })));
    return made;
  });
  return json({ chart }, 201);
});
