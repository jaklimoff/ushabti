import { carriesDates } from "./option-dates";
import { readReleaseBy } from "./releases";
import { readSprintBy } from "./sprints";

/*
 * A new project that starts with the setup of another one. Everything is
 * made new, so every id the source's rows name is mapped to the new one.
 * Nothing here reads or writes the database: the route reads the source,
 * hands it in, and writes what comes back in one transaction.
 *
 * The options of a property that carries dates stay behind. A version or a
 * sprint is the old project's timeline, not its setup, so the property comes
 * over empty and nothing that named one of them keeps the name.
 */

type Json = unknown;

export type SetupProperty = {
  id: string;
  name: string;
  type: string;
  position: string;
  config: Json;
};

export type SetupOption = {
  id: string;
  propertyId: string;
  name: string;
  color: string;
  icon: string | null;
  position: string;
};

export type SetupView = {
  name: string;
  kind: string;
  groupById: string | null;
  position: string;
  isDefault: boolean;
  config: Json;
  cardView: Json;
};

/** What the new project takes from the source's own row. */
export type SetupPointers = {
  cardView: Json;
  doneWhen: Json;
  progressBy: string | null;
  typeBy: string | null;
  releaseBy: string | null;
  sprintBy: string | null;
  agentRules: string;
};

export type Setup = {
  project: SetupPointers;
  properties: SetupProperty[];
  options: SetupOption[];
  views: SetupView[];
};

const DROP = Symbol("drop");

/**
 * Every string that is an old id becomes the new one, and one that names a
 * left-out option goes: out of a list, out of an object by key or value. It
 * walks the whole of a config, so a key added to a config later is mapped
 * with no change here.
 */
function remap(value: Json, ids: Map<string, string>, gone: Set<string>): Json | typeof DROP {
  if (typeof value === "string") {
    if (gone.has(value)) return DROP;
    return ids.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => remap(v, ids, gone)).filter((v) => v !== DROP);
  }
  if (value && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [key, v] of Object.entries(value)) {
      if (gone.has(key)) continue;
      const mapped = remap(v, ids, gone);
      if (mapped === DROP) continue;
      out[ids.get(key) ?? key] = mapped;
    }
    return out;
  }
  return value;
}

/** A rule that only named left-out options asks a question nobody answered. */
function withoutEmptyRules(config: Json): Json {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;
  const filters = (config as { filters?: { rules?: unknown } }).filters;
  if (!filters || !Array.isArray(filters.rules)) return config;
  const rules = filters.rules.filter(
    (r) => !(r && typeof r === "object" && Array.isArray(r.values) && r.values.length === 0),
  );
  return { ...config, filters: { ...filters, rules } };
}

/**
 * The new project's rows, with new ids from `newId`. The order of every list
 * is the source's, and the ranks are kept as they are, so the order is too.
 */
export function copySetup(source: Setup, newId: () => string): Setup {
  const ids = new Map<string, string>();
  const gone = new Set<string>();
  const dated = new Set<string>();

  for (const p of source.properties) {
    ids.set(p.id, newId());
    if (carriesDates({ type: p.type, config: asConfig(p.config) })) dated.add(p.id);
  }
  for (const o of source.options) {
    if (dated.has(o.propertyId) || !ids.has(o.propertyId)) gone.add(o.id);
    else ids.set(o.id, newId());
  }

  const map = (value: Json): Json => {
    const mapped = remap(value, ids, gone);
    return mapped === DROP ? null : mapped;
  };
  /* A pointer names a property of this project or none: an old id the map
     does not know would name a property of the source. */
  const pointer = (id: string | null) => (id ? (ids.get(id) ?? null) : null);

  const doneWhen = map(source.project.doneWhen) as { optionIds?: unknown } | null;
  const doneNamesNothing =
    doneWhen && Array.isArray(doneWhen.optionIds) && doneWhen.optionIds.length === 0;

  return {
    project: {
      cardView: map(source.project.cardView),
      doneWhen: doneNamesNothing ? null : doneWhen,
      progressBy: pointer(source.project.progressBy),
      typeBy: pointer(source.project.typeBy),
      releaseBy: pointer(source.project.releaseBy),
      sprintBy: pointer(source.project.sprintBy),
      agentRules: source.project.agentRules,
    },
    properties: source.properties.map((p) => ({
      id: ids.get(p.id)!,
      name: p.name,
      type: p.type,
      position: p.position,
      config: map(p.config) ?? {},
    })),
    options: source.options
      .filter((o) => !gone.has(o.id))
      .map((o) => ({
        id: ids.get(o.id)!,
        propertyId: ids.get(o.propertyId)!,
        name: o.name,
        color: o.color,
        icon: o.icon,
        position: o.position,
      })),
    views: source.views.map((v) => ({
      name: v.name,
      kind: v.kind,
      groupById: pointer(v.groupById),
      position: v.position,
      isDefault: v.isDefault,
      config: withoutEmptyRules(map(v.config) ?? {}),
      cardView: map(v.cardView),
    })),
  };
}

function asConfig(config: Json): { dated?: boolean } | null {
  return config && typeof config === "object" ? (config as { dated?: boolean }) : null;
}

/* ------------------------------------------------------------------ */
/* What the form says comes over                                        */
/* ------------------------------------------------------------------ */

/** The counts the line under the tiles is made of. */
export type SetupSummary = {
  name: string;
  properties: number;
  /** Options that come over: those of a dated property stay behind. */
  options: number;
  views: number;
  card: boolean;
  agentRules: boolean;
  releases: boolean;
  sprints: boolean;
};

export function summarize(
  source: Pick<Setup, "properties" | "options" | "views"> & {
    project: SetupPointers & { name: string };
  },
): SetupSummary {
  const named = source.properties.map((p) => ({
    id: p.id,
    type: p.type,
    config: asConfig(p.config),
  }));
  const dated = new Set(
    source.properties
      .filter((p) => carriesDates({ type: p.type, config: asConfig(p.config) }))
      .map((p) => p.id),
  );
  return {
    name: source.project.name,
    properties: source.properties.length,
    options: source.options.filter((o) => !dated.has(o.propertyId)).length,
    views: source.views.length,
    card: source.project.cardView !== null && source.project.cardView !== undefined,
    agentRules: source.project.agentRules.trim() !== "",
    releases: readReleaseBy(source.project.releaseBy, named) !== null,
    sprints: readSprintBy(source.project.sprintBy, named) !== null,
  };
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One line, in counts. A part the source does not have is left out; the two
 * switches are always said, because off is an answer too.
 */
export function setupLine(s: SetupSummary): string {
  const parts: string[] = [];
  if (s.properties > 0) {
    const props = count(s.properties, "property", "properties");
    parts.push(s.options > 0 ? `${props} with their options` : props);
  }
  if (s.views > 0) parts.push(count(s.views, "view", "views"));
  if (s.card) parts.push("the card");
  if (s.agentRules) parts.push("the agent rules");
  parts.push(`releases ${s.releases ? "on" : "off"}`);
  parts.push(`sprints ${s.sprints ? "on" : "off"}`);
  const empty = [
    s.releases ? "Releases start with no versions." : "",
    s.sprints ? "Sprints start with none." : "",
  ].filter(Boolean);
  return [
    `From ${s.name}: ${parts.join(", ")}.`,
    ...empty,
    "Tasks, people and webhooks stay behind.",
  ].join(" ");
}
