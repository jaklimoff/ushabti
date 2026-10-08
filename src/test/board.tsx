import type { ReactNode } from "react";
import { vi } from "vitest";
import { render } from "vitest-browser-react";
import { BoardProvider } from "@/components/board/store";
import type { SessionUser } from "@/components/ui/UserMenu";
import { defaultCardView } from "@/lib/card-view";
import { DEFAULT_PROPERTIES, DEFAULT_VIEWS } from "@/lib/defaults";
import type { BoardData, PropertyDTO, TaskDTO, TaskValue } from "@/lib/types";

/*
 * A component test draws a component inside a real board store and answers
 * its requests here, in the page, rather than from a server. What the store
 * sends is written down, so a test says what a press sent as well as what
 * the screen drew.
 */

let made = 0;
/** A uuid, because a route reads every id as one. Counted, so a failure reads the same twice. */
function id(): string {
  made += 1;
  return `00000000-0000-4000-8000-${String(made).padStart(12, "0")}`;
}

/* An eight-letter rank per index, which sorts as the number does. */
const rank = (n: number) => `a${String(n).padStart(7, "0")}`;

export const ME: SessionUser = {
  id: id(),
  name: "Ada Tester",
  email: "ada@example.com",
  color: "#4b8fbe",
  emoji: null,
};

/** A new project as the server makes one: the default properties and views, and no tasks. */
export function newProject(): BoardData {
  const properties: PropertyDTO[] = DEFAULT_PROPERTIES.map((p, i) => ({
    id: id(),
    name: p.name,
    type: p.type,
    position: rank(i),
    config: {},
    options: (p.options ?? []).map((o, j) => ({
      id: id(),
      name: o.name,
      color: o.color,
      position: rank(j),
      startAt: null,
      targetAt: null,
      shippedAt: null,
      note: null,
    })),
  }));
  const named = (name: string | null) => properties.find((p) => p.name === name)?.id ?? null;
  const views = DEFAULT_VIEWS.map((v, i) => ({
    id: id(),
    name: v.name,
    kind: v.kind,
    groupById: named(v.groupBy),
    position: rank(i),
    isDefault: v.isDefault,
    filters: { rules: [] },
    lens: { rules: [] },
    sort: null,
    lensSort: null,
    cardView: null,
  }));
  return {
    project: {
      id: id(),
      name: "Testing",
      key: "TST",
      ownerId: ME.id,
      role: "owner",
      doneWhen: null,
      progressBy: null,
      typeBy: null,
      releaseBy: null,
      sprintBy: null,
      timeZone: "UTC",
      publicChangelog: false,
      agentRules: null,
    },
    today: "2026-10-08",
    members: [{ ...ME, role: "owner", kind: "human", listeningAt: null }],
    former: [],
    invites: [],
    properties,
    views,
    cardView: defaultCardView(properties, views[0].groupById),
    tasks: [],
    archived: [],
    archivedUnder: {},
    runs: [],
  };
}

export function propertyOf(data: BoardData, name: string): PropertyDTO {
  const property = data.properties.find((p) => p.name === name);
  if (!property) throw new Error(`No property is called ${name}.`);
  return property;
}

export function optionOf(data: BoardData, property: string, name: string): string {
  const option = propertyOf(data, property).options.find((o) => o.name === name);
  if (!option) throw new Error(`${property} has no option called ${name}.`);
  return option.id;
}

/**
 * Puts a task on the board. Values are named as a person reads them: an
 * option by its name, a multi-select by a list of names, anything else as
 * it is stored.
 */
export function withTask(
  data: BoardData,
  title: string,
  values: Record<string, string | string[] | number | boolean> = {},
): TaskDTO {
  const number = data.tasks.length + 1;
  const stored: Record<string, TaskValue> = {};
  for (const [name, value] of Object.entries(values)) {
    const property = propertyOf(data, name);
    const byName = (v: string) => property.options.find((o) => o.name === v)?.id ?? v;
    stored[property.id] = Array.isArray(value)
      ? value.map(byName)
      : typeof value === "string"
        ? byName(value)
        : value;
  }
  const task: TaskDTO = {
    id: id(),
    number,
    key: `${data.project.key}-${number}`,
    title,
    description: "",
    position: rank(number),
    createdAt: "2026-10-08T09:00:00.000Z",
    updatedAt: "2026-10-08T09:00:00.000Z",
    archivedAt: null,
    values: stored,
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    blockedBy: [],
    parts: null,
  };
  data.tasks.push(task);
  return task;
}

/** One request the component sent, with its body read as JSON. */
export type Sent = { method: string; path: string; body: unknown };

/** What a request is answered with. Nothing means 200 and `{}`. */
export type Answer = (sent: Sent) => { status?: number; body?: unknown } | undefined;

/**
 * Draws `ui` inside a board store holding `data`, and answers every request
 * with `answer`. A read of the board is answered with `data` unless `answer`
 * says otherwise. `sent()` lists what went out, presence aside, because
 * presence is the tab saying it is here and draws nothing.
 */
export async function renderWithBoard(
  ui: ReactNode,
  data: BoardData,
  answer: Answer = () => undefined,
) {
  const requests: Sent[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      const raw = init?.body ? String(init.body) : "";
      const sent: Sent = {
        method: init?.method ?? "GET",
        path: url.pathname,
        body: raw ? JSON.parse(raw) : undefined,
      };
      requests.push(sent);
      const said =
        answer(sent) ??
        (sent.method === "GET" && sent.path.endsWith("/board") ? { body: data } : undefined);
      return new Response(JSON.stringify(said?.body ?? {}), {
        status: said?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );

  /* The stream is the doorbell, and nobody rings it in a test. */
  vi.stubGlobal(
    "EventSource",
    class {
      onerror = null;
      onopen = null;
      addEventListener() {}
      close() {}
    },
  );

  /* The last view a person opened is kept per browser, and one test must not
     open on the view another left. */
  window.localStorage.clear();

  const screen = await render(
    <BoardProvider initial={data} user={ME}>
      {ui}
    </BoardProvider>,
  );

  const sent = (method?: string, path?: RegExp) =>
    requests.filter(
      (r) =>
        !r.path.endsWith("/presence") &&
        (!method || r.method === method) &&
        (!path || path.test(r.path)),
    );

  return { screen, sent };
}
