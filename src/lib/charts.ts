import type { BoardData } from "./types";
import { isSelect } from "./types";

/**
 * A chart on Home: how many tasks entered one option of one select, each
 * day, over the last thirty days in the project's zone. This half works out
 * the days and the words; `charts-load.ts` reads the counts.
 */

export const CHART_DAYS = 30;

export type StoredChart = {
  id: string;
  projectId: string;
  propertyId: string;
  optionId: string;
};

export type ChartDay = { day: string; count: number };

export type ChartDTO = {
  id: string;
  project: { id: string; key: string; name: string };
  property: string;
  option: string;
  color: string;
  /** Oldest first, the last one today. Always `CHART_DAYS` long. */
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
 * The names and the colour a stored chart draws with, read afresh off the
 * board. Null when there is nothing to draw: the property is gone or is no
 * longer a select, or the option is gone. Nothing deletes such a chart.
 */
export function chartShape(
  chart: StoredChart,
  board: Pick<BoardData, "project" | "properties">,
): Omit<ChartDTO, "days"> | null {
  const property = board.properties.find((p) => p.id === chart.propertyId);
  if (!property || !isSelect(property.type)) return null;
  const option = property.options.find((o) => o.id === chart.optionId);
  if (!option) return null;
  return {
    id: chart.id,
    project: { id: board.project.id, key: board.project.key, name: board.project.name },
    property: property.name,
    option: option.name,
    color: option.color,
  };
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
