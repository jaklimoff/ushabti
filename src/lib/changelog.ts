import { sortByPosition } from "./board";
import { isSelect } from "./types";

/**
 * The changelog: every shipped option of every select property, newest first,
 * with the tasks that carry it.
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
  /** True when the sprint rolled by itself on its end, not by a press of Ship. */
  ended: boolean;
  /** Markdown, or null when nobody wrote one. */
  note: string | null;
  /** In board order. */
  tasks: ChangelogTask[];
};

export type Changelog = {
  project: { id: string; name: string; key: string };
  entries: ChangelogEntry[];
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
    ended: boolean;
    note: string | null;
    tasks: { title: string }[];
  }[];
};

export type ChangelogInput = {
  project: { id: string; name: string; key: string };
  /** In `position` order, each with its options in `position` order. */
  properties: {
    id: string;
    name: string;
    type: string;
    options: {
      id: string;
      name: string;
      shippedAt: string | null;
      /** Absent reads as pressed. */
      rolled?: boolean;
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

export function buildChangelog(input: ChangelogInput): Changelog {
  const tasks = sortByPosition(input.tasks);
  const entries: ChangelogEntry[] = [];
  for (const prop of input.properties) {
    /* Only a select option carries a ship. A multi-select has none, and an
       option dated by some older write on another type is not a release. */
    if (!isSelect(prop.type)) continue;
    for (const option of prop.options) {
      if (!option.shippedAt) continue;
      entries.push({
        optionId: option.id,
        propertyId: prop.id,
        propertyName: prop.name,
        name: option.name,
        shippedAt: option.shippedAt,
        ended: option.rolled === true,
        note: option.note?.trim() ? option.note : null,
        tasks: tasks
          .filter((t) => t.values[prop.id] === option.id)
          .map((t) => ({ id: t.id, key: `${input.project.key}-${t.number}`, title: t.title })),
      });
    }
  }
  /* Newest first. Two options shipped on one day keep the order of the
     Settings drag, which the sort leaves alone because it is stable. */
  entries.sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : a.shippedAt > b.shippedAt ? -1 : 0));
  return { project: input.project, entries };
}

export function publicChangelog(log: Changelog): PublicChangelog {
  return {
    project: { name: log.project.name },
    entries: log.entries.map((e) => ({
      name: e.name,
      shippedAt: e.shippedAt,
      ended: e.ended,
      note: e.note,
      tasks: e.tasks.map((t) => ({ title: t.title })),
    })),
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

/** How the changelog dates an entry: a pressed one shipped, a rolled one ended. */
export function shippedSaid(entry: { shippedAt: string; ended: boolean }): string {
  return `${entry.ended ? "Ended" : "Shipped"} ${shippedDay(entry.shippedAt)}`;
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
