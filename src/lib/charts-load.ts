import "server-only";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, charts } from "@/db/schema";
import { humanOnly, readId } from "./api";
import { HttpError, requireActor } from "./auth";
import {
  chartChoice,
  chartDays,
  chartFrom,
  chartShape,
  type ChartChoice,
  type ChartDay,
  type ChartDTO,
} from "./charts";
import type { BoardOf, ProjectRow } from "./lists-load";
import { byPos } from "./order";

/**
 * The server half of a chart: whose it is, and the one query that counts it.
 * The days and the words are `charts.ts`, which never touches the database.
 */

/** The person's own chart, or a 404, as a list is. An agent has none. */
export async function ownChart(chartId: string) {
  const user = await requireActor();
  humanOnly(user);
  readId(chartId, "chart");
  const [chart] = await db
    .select()
    .from(charts)
    .where(and(eq(charts.id, chartId), eq(charts.userId, user.id)))
    .limit(1);
  if (!chart) throw new HttpError(404, "Chart not found.");
  return { user, chart };
}

export async function chartsOf(userId: string) {
  return db
    .select({
      id: charts.id,
      projectId: charts.projectId,
      propertyId: charts.propertyId,
      optionId: charts.optionId,
      position: charts.position,
    })
    .from(charts)
    .where(eq(charts.userId, userId))
    .orderBy(byPos(charts.position), asc(charts.id));
}

/**
 * How many tasks entered one option on each day from `from` on, by the day
 * in `timeZone`. A task enters an option when a value line sets it, or when
 * the task is created with it. The lines are matched by id only: a name can
 * change, and an older line with no id is not counted. One query, over the
 * feed's index by project and time.
 */
export async function countEntered(a: {
  projectId: string;
  propertyId: string;
  optionId: string;
  timeZone: string;
  from: string;
}): Promise<ChartDay[]> {
  const day = sql<string>`to_char(${activity.createdAt} at time zone ${a.timeZone}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, count: sql<number>`count(*)::int` })
    .from(activity)
    .where(
      and(
        eq(activity.projectId, a.projectId),
        sql`${activity.createdAt} >= (${a.from}::date::timestamp at time zone ${a.timeZone})`,
        or(
          and(
            eq(activity.kind, "value"),
            sql`${activity.data}->>'propertyId' = ${a.propertyId}`,
            sql`${activity.data}->>'optionId' = ${a.optionId}`,
          ),
          and(
            eq(activity.kind, "created"),
            sql`coalesce(${activity.data}->'options'->${a.propertyId}, '[]'::jsonb) @> ${JSON.stringify([a.optionId])}::jsonb`,
          ),
        ),
      ),
    )
    // By its place: the zone is a parameter, so the expression is not repeated.
    .groupBy(sql`1`);
  return rows;
}

/**
 * The person's charts as Home draws them, and what can be charted. A chart
 * whose project they left finds no board, and one whose property or option
 * is gone has no shape; neither is drawn, and nothing deletes it.
 */
export async function loadCharts(
  userId: string,
  projects: ProjectRow[],
  boardOf: BoardOf,
): Promise<{ charts: ChartDTO[]; choices: ChartChoice[] }> {
  const boards = await Promise.all(projects.map(boardOf));
  const byId = new Map(boards.map((b) => [b.project.id, b]));
  const stored = await chartsOf(userId);
  const drawn = await Promise.all(
    stored.map(async (chart) => {
      const board = byId.get(chart.projectId);
      const shape = board ? chartShape(chart, board) : null;
      if (!board || !shape) return null;
      const rows = await countEntered({
        ...chart,
        timeZone: board.project.timeZone,
        from: chartFrom(board.today),
      });
      return { ...shape, days: chartDays(rows, board.today) };
    }),
  );
  return {
    charts: drawn.filter((c): c is ChartDTO => c !== null),
    choices: boards.map(chartChoice).filter((c) => c.properties.length > 0),
  };
}
