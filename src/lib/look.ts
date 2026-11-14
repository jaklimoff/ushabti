import { KIND_OF_TYPE, OFF_EDGE } from "./card-view";
import { sameOptionName } from "./option-name";
import { CARD_BUILTINS, type CardView, type PropertyDTO, type PropertyOptionDTO } from "./types";

/**
 * The look of a project: its default card, and the icon and colour of each
 * option and checkbox. One project takes another's look as a copy, never a
 * link, so nothing here is kept after the press: a later change in one project
 * reaches no other until somebody copies again.
 *
 * This is the one place that says what matches, what is counted and what a
 * line says. The route and the Card page both ask it, so the numbers in the
 * question are the numbers the write uses.
 *
 * Nothing is matched by id, because ids belong to one project. A property
 * matches by name, read as an option name is, and only when both read the
 * same way on a card. A name that means one thing here and another there is
 * left alone rather than drawn in a way it cannot be.
 */

/** What a press copies. Each half has its own tick. */
export type LookParts = { layout: boolean; looks: boolean };

/** One property here and the one it takes its look from, with their options. */
export type LookPair = {
  here: PropertyDTO;
  there: PropertyDTO;
  options: { here: PropertyOptionDTO; there: PropertyOptionDTO }[];
};

export type LookMatch = {
  pairs: LookPair[];
  /** The properties here with nothing there to read, in their order. */
  unmatched: PropertyDTO[];
};

/**
 * Pairs this project's properties with another's. Both lists must be in their
 * order, as `loadProperties` reads them: when several there fit, the first
 * matches, and a property there is taken by one property here at most.
 */
export function matchLook(here: PropertyDTO[], there: PropertyDTO[]): LookMatch {
  const taken = new Set<string>();
  const pairs: LookPair[] = [];
  const unmatched: PropertyDTO[] = [];
  for (const mine of here) {
    const theirs = there.find(
      (p) =>
        !taken.has(p.id) &&
        sameOptionName(p.name, mine.name) &&
        KIND_OF_TYPE[p.type] === KIND_OF_TYPE[mine.type],
    );
    if (!theirs) {
      unmatched.push(mine);
      continue;
    }
    taken.add(theirs.id);
    pairs.push({ here: mine, there: theirs, options: matchOptions(mine.options, theirs.options) });
  }
  return { pairs, unmatched };
}

function matchOptions(here: PropertyOptionDTO[], there: PropertyOptionDTO[]) {
  const taken = new Set<string>();
  const out: LookPair["options"] = [];
  for (const mine of here) {
    const theirs = there.find((o) => !taken.has(o.id) && sameOptionName(o.name, mine.name));
    if (!theirs) continue;
    taken.add(theirs.id);
    out.push({ here: mine, there: theirs });
  }
  return out;
}

/** What one project line counts. */
export type LookCount = {
  /** This project's properties with a match there. */
  matched: number;
  /** This project's properties. */
  total: number;
  /** This project's options and checkboxes that would take a look. */
  looks: number;
  /** The names of this project's properties with no match, in their order. */
  unmatched: string[];
};

export function countLook(match: LookMatch): LookCount {
  let looks = 0;
  for (const pair of match.pairs) {
    looks += pair.here.type === "checkbox" ? 1 : pair.options.length;
  }
  return {
    matched: match.pairs.length,
    total: match.pairs.length + match.unmatched.length,
    looks,
    unmatched: match.unmatched.map((p) => p.name),
  };
}

/**
 * This project's card after it takes the other's layout. Each row a task has
 * of its own and each matched property takes its row there; a property with
 * no match keeps its own. When the edge comes across, a row here that held it
 * gives it up, because a card has one edge. The caller still reads the answer
 * through `readCardView` before it is stored.
 */
export function copiedCardView(here: CardView, there: CardView, match: LookMatch): CardView {
  const rows = { ...here.rows };
  const written = new Set<string>();
  for (const id of CARD_BUILTINS) {
    const row = there.rows[id];
    if (!row) continue;
    rows[id] = { ...row };
    written.add(id);
  }
  for (const pair of match.pairs) {
    const row = there.rows[pair.there.id];
    if (!row) continue;
    rows[pair.here.id] = { ...row };
    written.add(pair.here.id);
  }
  const edgeCame = [...written].some((id) => rows[id].place === "edge");
  if (edgeCame) {
    for (const [id, row] of Object.entries(rows)) {
      if (!written.has(id) && row.place === "edge") rows[id] = { ...row, place: OFF_EDGE };
    }
  }
  return { rows };
}

/** The icon and colour each matched option and checkbox takes. */
export type LookWrites = {
  options: { id: string; color: string; icon: string | null }[];
  checkboxes: { id: string; color: string | null; icon: string | null }[];
};

export function copiedLooks(match: LookMatch): LookWrites {
  const out: LookWrites = { options: [], checkboxes: [] };
  for (const pair of match.pairs) {
    if (pair.here.type === "checkbox") {
      out.checkboxes.push({
        id: pair.here.id,
        color: pair.there.config.color ?? null,
        icon: pair.there.config.icon ?? null,
      });
      continue;
    }
    for (const { here, there } of pair.options) {
      out.options.push({ id: here.id, color: there.color, icon: there.icon });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

function namesSaid(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function looksSaid(n: number): string {
  return n === 1 ? "1 icon and colour" : `${n} icons and colours`;
}

/** The counts on one project line, with only the halves that are ticked. */
export function countSaid(count: LookCount, parts: LookParts): string {
  const said: string[] = [];
  if (parts.layout) said.push(`${count.matched} of ${count.total} properties`);
  if (parts.looks) said.push(looksSaid(count.looks));
  return said.join(" · ");
}

/** What a partial match leaves alone, or null when every property matches. */
export function staysSaid(count: LookCount): string | null {
  const names = count.unmatched;
  if (names.length === 0) return null;
  return names.length === 1
    ? `${names[0]} here stays as it is.`
    : `${namesSaid(names)} here stay as they are.`;
}

/** Why the press is off, or null when it may be pressed. */
export function blockedSaid(picked: boolean, parts: LookParts): string | null {
  if (!picked) return "Pick a project to copy from.";
  if (!parts.layout && !parts.looks) return "Pick what to copy.";
  return null;
}

/** The question the strip asks, in the numbers the write will use. */
export function copyQuestion(from: string, count: LookCount, parts: LookParts): string {
  const n = count.looks;
  const takes =
    n === 1
      ? "1 option or checkbox takes its icon and colour"
      : `${n} options and checkboxes take its icon and colour`;
  const what =
    parts.layout && parts.looks
      ? `This project's default card is replaced, and ${takes}.`
      : parts.layout
        ? "This project's default card is replaced."
        : `${takes[0].toUpperCase()}${takes.slice(1)}.`;
  return `Copy the look of ${from}? ${what} Tasks do not change.`;
}
