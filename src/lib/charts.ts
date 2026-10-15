import type { BoardData } from "./types";
import { isSelect } from "./types";

/**
 * A chart on Home: how many tasks entered one option of one select, each
 * day, over the last thirty days in the project's zone, summed over one
 * source per project. This half works out
 * the days and the words; `charts-load.ts` reads the counts.
 */

export const CHART_DAYS = 30;

/** Said by the picker and by the route, so the two never word it apart. */
export const CHART_TWICE = "You already have this chart. Pick another column.";

/** One option of one select in one project, as a chart stores it. */
export type StoredSource = {
  projectId: string;
  propertyId: string;
  optionId: string;
};

export type StoredChart = { id: string; sources: StoredSource[] };

export type ChartDay = { day: string; count: number };

/** One source as it is drawn: its names, read afresh, and its own count a day. */
export type ChartSource = {
  project: { id: string; key: string; name: string };
  propertyId: string;
  optionId: string;
  property: string;
  option: string;
  color: string;
  days: ChartDay[];
};

export type ChartDTO = {
  id: string;
  /** Only the sources that can still be drawn, in the chart's order. */
  sources: ChartSource[];
  /** The first source's option: one bar, one colour. */
  color: string;
  /** The sum of every source. Oldest first, the last one today. Always `CHART_DAYS` long. */
  days: ChartDay[];
};

/** What can be charted in one project: its selects and their options. */
export type ChartChoice = {
  id: string;
  key: string;
  name: string;
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
};

/** The day `n` days before `day`, both as YYYY-MM-DD. A calendar day has no zone. */
export function dayBefore(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** The first day a chart drawn on `today` shows. */
export function chartFrom(today: string): string {
  return dayBefore(today, CHART_DAYS - 1);
}

/**
 * Thirty days ending on `today`, each with its count. A day with no row is
 * a day nobody entered the option, which is a zero and not a gap; a row
 * outside the range is ignored. A project card's pulse asks the same for
 * fewer days.
 */
export function chartDays(rows: ChartDay[], today: string, length = CHART_DAYS): ChartDay[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.day, (counts.get(r.day) ?? 0) + Number(r.count));
  const days: ChartDay[] = [];
  for (let n = length - 1; n >= 0; n--) {
    const day = dayBefore(today, n);
    days.push({ day, count: counts.get(day) ?? 0 });
  }
  return days;
}

/** The words under the bars: today's number and the average a day, to one place. */
export function chartSummary(days: ChartDay[]): { today: number; average: string } {
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const average = days.length ? Math.round((total / days.length) * 10) / 10 : 0;
  return { today: days.at(-1)?.count ?? 0, average: String(average) };
}

/**
 * The names and the colour one source draws with, read afresh off its board.
 * Null when there is nothing to draw: the property is gone or is no longer a
 * select, or the option is gone. Nothing deletes such a source.
 */
export function sourceShape(
  source: StoredSource,
  board: Pick<BoardData, "project" | "properties">,
): Omit<ChartSource, "days"> | null {
  const property = board.properties.find((p) => p.id === source.propertyId);
  if (!property || !isSelect(property.type)) return null;
  const option = property.options.find((o) => o.id === source.optionId);
  if (!option) return null;
  return {
    project: { id: board.project.id, key: board.project.key, name: board.project.name },
    propertyId: property.id,
    optionId: option.id,
    property: property.name,
    option: option.name,
    color: option.color,
  };
}

/**
 * A chart off what each of its sources counted. The days are the first
 * source's, so a project in another zone adds its counts to the same dates;
 * each bar is the sum. Null when no source is left to draw.
 */
export function sumChart(
  id: string,
  counted: { shape: Omit<ChartSource, "days">; rows: ChartDay[] }[],
  today: string,
): ChartDTO | null {
  if (counted.length === 0) return null;
  const sources = counted.map((c) => ({ ...c.shape, days: chartDays(c.rows, today) }));
  return {
    id,
    sources,
    color: sources[0].color,
    days: chartDays(
      counted.flatMap((c) => c.rows),
      today,
    ),
  };
}

/**
 * What a chart's heading says: the keys of its projects, and the options it
 * counts, each name once. `title` is the whole of it, for a heading cut short.
 */
export function chartHeading(chart: Pick<ChartDTO, "sources">): {
  keys: string;
  options: string;
  title: string;
} {
  const keys = chart.sources.map((s) => s.project.key).join(" · ");
  const options = [...new Set(chart.sources.map((s) => s.option))].join(", ");
  return { keys, options, title: `${keys} Entered ${options}` };
}

/** Each project's count on one day, by key, when there is more than one. */
export function chartSplit(chart: Pick<ChartDTO, "sources">, index: number): string | null {
  if (chart.sources.length < 2) return null;
  return chart.sources.map((s) => `${s.project.key} ${s.days[index]?.count ?? 0}`).join(", ");
}

/** The words under a chart: which select it reads, in which projects. */
export function chartHint(chart: Pick<ChartDTO, "sources">): string {
  const names = new Set(chart.sources.map((s) => s.property));
  if (names.size === 1) {
    return `${chart.sources[0].property} in ${chart.sources.map((s) => s.project.name).join(", ")}`;
  }
  return chart.sources.map((s) => `${s.property} in ${s.project.name}`).join(", ");
}

const sourceKey = (s: StoredSource) => `${s.projectId}/${s.propertyId}/${s.optionId}`;

/** Whether two charts count the same, whatever order their sources are in. */
export function sameSources(a: StoredSource[], b: StoredSource[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(sourceKey));
  return b.every((s) => keys.has(sourceKey(s)));
}

/** The selects of one board, for the picker. A project with none offers nothing. */
export function chartChoice(board: Pick<BoardData, "project" | "properties">): ChartChoice {
  return {
    id: board.project.id,
    key: board.project.key,
    name: board.project.name,
    properties: board.properties
      .filter((p) => isSelect(p.type) && p.options.length > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        options: p.options.map((o) => ({ id: o.id, name: o.name })),
      })),
  };
}

/**
 * The option a new chart starts on: the last one the person does not chart
 * yet, since the last column is usually the one that means done. When they
 * chart them all, the last one, which the picker then says is taken.
 */
export function firstUncharted(options: { id: string }[], charted: ReadonlySet<string>): string {
  return options.findLast((o) => !charted.has(o.id))?.id ?? options.at(-1)?.id ?? "";
}
