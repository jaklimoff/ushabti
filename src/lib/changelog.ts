import { sortByPosition } from "./board";
import { isSelect } from "./types";

/**
 * The changelog: every shipped option of every select property, newest first,
 * with the tasks that carry it. A sprint closes and never ships, so an
 * iteration lists nothing here.
 *
 * It costs no table of its own. A ship writes `shippedAt` on the option and
 * archives what was over, so the options and the archived tasks are the
 * record. Everything here is pure: the loader reads the rows and asks this
 * file what to draw, so the member page, the public page and the route can
 * never tell the story three ways.
 */

/** One task under a shipped option. */
export type ChangelogTask = { id: string; key: string; title: string };

/** One shipped option. */
export type ChangelogEntry = {
  optionId: string;
  propertyId: string;
  propertyName: string;
  name: string;
  /** YYYY-MM-DD. */
  shippedAt: string;
  /** Markdown, or null when nobody wrote one. */
  note: string | null;
  /** In board order. */
  tasks: ChangelogTask[];
};

export type Changelog = {
  /** The colour draws the project's mark in the bar, as on every other page. */
  project: { id: string; name: string; key: string; color?: string };
  entries: ChangelogEntry[];
  /** How many shipped options are older than the last entry here. */
  older: number;
};

/**
 * What a stranger reads. No key, no id and no person: a key is a way into a
 * board the reader cannot open, and a name on a public page is somebody who
 * did not agree to be on one.
 */
export type PublicChangelog = {
  project: { name: string };
  entries: {
    name: string;
    shippedAt: string;
    note: string | null;
    tasks: { title: string }[];
  }[];
  older: number;
};

export type ChangelogInput = {
  project: { id: string; name: string; key: string; color?: string };
  /** In `position` order, each with its options in `position` order. */
  properties: {
    id: string;
    name: string;
    type: string;
    options: {
      id: string;
      name: string;
      shippedAt: string | null;
      note: string | null;
    }[];
  }[];
  /** Live and archived alike; never a deleted one. */
  tasks: {
    id: string;
    number: number;
    title: string;
    position: string;
    values: Record<string, unknown>;
  }[];
};

/** True when a property's shipped options are releases the changelog lists. */
export function isRelease(type: string): boolean {
  return isSelect(type) && type !== "iteration";
}

type Property = ChangelogInput["properties"][number];
type Option = Property["options"][number];

/**
 * Every shipped option, newest first: the one order of the changelog, so the
 * options a page draws and the entries it builds can never disagree.
 */
function shippedOptions(
  properties: Property[],
): { prop: Property; option: Option; shippedAt: string }[] {
  const found: { prop: Property; option: Option; shippedAt: string }[] = [];
  for (const prop of properties) {
    /* Only a select option carries a ship. A multi-select has none, an
       option dated by some older write on another type is not a release,
       and a closed sprint is not one either. */
    if (!isRelease(prop.type)) continue;
    for (const option of prop.options) {
      if (option.shippedAt) found.push({ prop, option, shippedAt: option.shippedAt });
    }
  }
  /* Newest first. Two options shipped on one day keep the order of the
     Settings drag, which the sort leaves alone because it is stable. */
  return found.sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : a.shippedAt > b.shippedAt ? -1 : 0));
}

/** How many releases a changelog page opens on, and how many **Older** adds. */
export const CHANGELOG_PAGE = 10;

/**
 * How many entries a page draws, from `?shown=` in its address. Anything
 * that is not a whole number of pages is read as the first page, so an
 * address somebody typed cannot ask for one entry or for all of them.
 */
export function readShown(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
  return n >= CHANGELOG_PAGE && n % CHANGELOG_PAGE === 0 ? n : CHANGELOG_PAGE;
}

/**
 * The properties with only the newest `shown` shipped options left on them,
 * and how many shipped options were left off. The loader reads the tasks of
 * what is left and no others, so a page of ten releases never reads a
 * hundred.
 */
export function newestShipped(
  properties: Property[],
  shown: number,
): { properties: Property[]; older: number } {
  const all = shippedOptions(properties);
  const kept = new Set(all.slice(0, shown).map((s) => s.option.id));
  return {
    properties: properties.map((p) => ({
      ...p,
      options: p.options.filter((o) => kept.has(o.id)),
    })),
    older: all.length - kept.size,
  };
}

export function buildChangelog(input: ChangelogInput, older = 0): Changelog {
  const tasks = sortByPosition(input.tasks);
  const entries: ChangelogEntry[] = shippedOptions(input.properties).map(
    ({ prop, option, shippedAt }) => ({
      optionId: option.id,
      propertyId: prop.id,
      propertyName: prop.name,
      name: option.name,
      shippedAt,
      note: option.note?.trim() ? option.note : null,
      tasks: tasks
        .filter((t) => t.values[prop.id] === option.id)
        .map((t) => ({ id: t.id, key: `${input.project.key}-${t.number}`, title: t.title })),
    }),
  );
  return { project: input.project, entries, older };
}

export function publicChangelog(log: Changelog): PublicChangelog {
  return {
    project: { name: log.project.name },
    entries: log.entries.map((e) => ({
      name: e.name,
      shippedAt: e.shippedAt,
      note: e.note,
      tasks: e.tasks.map((t) => ({ title: t.title })),
    })),
    older: log.older,
  };
}

/** The address of a public changelog. The slug is the key, in lower case. */
export function changelogSlug(key: string): string {
  return key.toLowerCase();
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** How the changelog dates an entry. */
export function shippedSaid(entry: { shippedAt: string }): string {
  return `Shipped ${shippedDay(entry.shippedAt)}`;
}

/**
 * The day an option shipped, in words. It is cut from the string and never
 * made into a `Date`: a date is a day, and a `Date` reads it in the zone of
 * whoever draws it, which moves it back a day west of UTC.
 */
export function shippedDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const month = MONTHS[m - 1];
  return month && d ? `${month} ${d}, ${y}` : day;
}
