import "server-only";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, charts, chartSources, properties, propertyOptions } from "@/db/schema";
import { guard, humanOnly, readId } from "./api";
import { HttpError, requireActor } from "./auth";
import {
  chartChoice,
  chartFrom,
  sourceShape,
  sumChart,
  type ChartChoice,
  type ChartDay,
  type ChartDTO,
  type StoredChart,
  type StoredSource,
} from "./charts";
import type { BoardOf, ProjectRow } from "./lists-load";
import { byPos } from "./order";
import { isSelect, type BoardData } from "./types";

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

/** The person's charts, in their order, each with its sources in theirs. */
export async function chartsOf(
  userId: string,
  tx: Pick<typeof db, "select"> = db,
): Promise<(StoredChart & { position: string })[]> {
  const rows = await tx
    .select({ id: charts.id, position: charts.position })
    .from(charts)
    .where(eq(charts.userId, userId))
    .orderBy(byPos(charts.position), asc(charts.id));
  if (rows.length === 0) return [];
  const sources = await tx
    .select({
      chartId: chartSources.chartId,
      projectId: chartSources.projectId,
      propertyId: chartSources.propertyId,
      optionId: chartSources.optionId,
    })
    .from(chartSources)
    .where(
      inArray(
        chartSources.chartId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(byPos(chartSources.position), asc(chartSources.id));
  return rows.map((r) => ({
    ...r,
    sources: sources
      .filter((s) => s.chartId === r.id)
      .map(({ projectId, propertyId, optionId }) => ({ projectId, propertyId, optionId })),
  }));
}

/* Enough for every project a person works in at once, and no runaway. */
const SOURCES_MAX = 20;

/**
 * The sources a chart is asked for, by shape only: one or more, each one
 * project at most once. A body of one source's three ids, as the picker sent
 * before a chart had sources, reads as that one.
 */
export function readSources(
  input: { sources?: unknown } & Record<string, unknown>,
): StoredSource[] {
  const raw = Array.isArray(input.sources) ? input.sources : [input];
  if (raw.length === 0 || raw.length > SOURCES_MAX) {
    throw new HttpError(400, `A chart counts one to ${SOURCES_MAX} projects.`);
  }
  const sources = raw.map((r: Record<string, unknown> | null) => ({
    projectId: readId(r?.projectId, "project"),
    propertyId: readId(r?.propertyId, "property"),
    optionId: readId(r?.optionId, "option"),
  }));
  if (new Set(sources.map((s) => s.projectId)).size !== sources.length) {
    throw new HttpError(400, "A chart takes each project once.");
  }
  return sources;
}

/**
 * Each source's project is one the caller is in, through `guard`, and each
 * names an option of a select there. Answers the caller's role in each
 * project, in the sources' order.
 */
export async function checkSources(sources: StoredSource[]) {
  const roles: string[] = [];
  for (const source of sources) {
    roles.push((await guard(source.projectId)).membership.role);
    const [property] = await db
      .select({ type: properties.type })
      .from(properties)
      .where(and(eq(properties.id, source.propertyId), eq(properties.projectId, source.projectId)))
      .limit(1);
    if (!property || !isSelect(property.type)) {
      throw new HttpError(400, "A chart counts the options of a select.");
    }
    const [option] = await db
      .select({ id: propertyOptions.id })
      .from(propertyOptions)
      .where(
        and(
          eq(propertyOptions.id, source.optionId),
          eq(propertyOptions.propertyId, source.propertyId),
        ),
      )
      .limit(1);
    if (!option) throw new HttpError(400, "That option does not exist any more.");
  }
  return { roles };
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
 * One chart as Home draws it, off the boards of its projects: one count per
 * source, summed in `charts.ts`. A saved chart and the picker's preview both
 * come through here, so the two cannot count apart. A source whose project
 * finds no board, or whose property or option is gone, counts nothing; null
 * when none is left.
 */
export async function drawChart(
  chart: StoredChart,
  boardOf: (projectId: string) => Pick<BoardData, "project" | "properties" | "today"> | undefined,
): Promise<ChartDTO | null> {
  const drawn = chart.sources.flatMap((source) => {
    const board = boardOf(source.projectId);
    const shape = board && sourceShape(source, board);
    return board && shape ? [{ source, board, shape }] : [];
  });
  if (drawn.length === 0) return null;
  const today = drawn[0].board.today;
  const counted = await Promise.all(
    drawn.map(async ({ source, board, shape }) => ({
      shape,
      rows: await countEntered({
        ...source,
        timeZone: board.project.timeZone,
        from: chartFrom(today),
      }),
    })),
  );
  return sumChart(chart.id, counted, today);
}

/**
 * The person's charts as Home draws them, and what can be charted. A source
 * whose project they left finds no board, and one whose property or option
 * is gone has no shape; neither counts, and nothing deletes it.
 */
export async function loadCharts(
  userId: string,
  projects: ProjectRow[],
  boardOf: BoardOf,
): Promise<{ charts: ChartDTO[]; choices: ChartChoice[] }> {
  const boards = await Promise.all(projects.map(boardOf));
  const byId = new Map(boards.map((b) => [b.project.id, b]));
  const stored = await chartsOf(userId);
  const drawn = await Promise.all(stored.map((chart) => drawChart(chart, (id) => byId.get(id))));
  return {
    charts: drawn.filter((c): c is ChartDTO => c !== null),
    choices: boards.map(chartChoice).filter((c) => c.properties.length > 0),
  };
}
