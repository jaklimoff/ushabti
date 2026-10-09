import type { ReactNode } from "react";
import { vi } from "vitest";
import { render } from "vitest-browser-react";
import { BoardProvider } from "@/components/board/store";
import type { SessionUser } from "@/components/ui/UserMenu";
import { defaultCardView } from "@/lib/card-view";
import { DEFAULT_PROPERTIES, DEFAULT_VIEWS } from "@/lib/defaults";
import type { PresenceSaid } from "@/lib/presence";
import type {
  AgentRunDTO,
  BoardData,
  MemberDTO,
  PropertyDTO,
  TaskDetailDTO,
  TaskDTO,
  TaskValue,
} from "@/lib/types";

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

/** A moment this many minutes before now, as the server writes one. */
export const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

/** An agent among the members. `listeningAt` is when its stream last said it was open. */
export function withAgent(
  data: BoardData,
  name: string,
  listeningAt: string | null = null,
): MemberDTO {
  const agent: MemberDTO = {
    id: id(),
    name,
    email: null,
    color: "#8b6cd9",
    emoji: null,
    role: "member",
    kind: "agent",
    listeningAt,
  };
  data.members.push(agent);
  return agent;
}

/** A person among the members, a member unless `role` says otherwise. */
export function withPerson(
  data: BoardData,
  name: string,
  role: MemberDTO["role"] = "member",
): MemberDTO {
  const person: MemberDTO = {
    id: id(),
    name,
    email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`,
    color: "#c47a3a",
    emoji: null,
    role,
    kind: "human",
    listeningAt: null,
  };
  data.members.push(person);
  return person;
}

/**
 * A run of `agent` on `task`, started ten minutes ago and running, with its
 * last report a moment ago, unless `fields` says otherwise. The agent need not be a member: a removed one
 * still names its runs. It is not on the board; `withRun` puts it there.
 */
export function runOn(
  task: TaskDTO,
  agent: Pick<MemberDTO, "id" | "name" | "color" | "emoji">,
  fields: Partial<AgentRunDTO> = {},
): AgentRunDTO {
  const now = minutesAgo(0);
  return {
    id: id(),
    taskId: task.id,
    status: "running",
    goal: "Do the work",
    step: "",
    control: null,
    startedAt: minutesAgo(10),
    updatedAt: now,
    beatAt: now,
    reportDueAt: null,
    endedAt: null,
    agent: { id: agent.id, name: agent.name, color: agent.color, emoji: agent.emoji },
    stepsTotal: 0,
    stepsDone: 0,
    lastLog: null,
    ...fields,
  };
}

/** An open run on the board. The board carries only open runs, one per task. */
export function withRun(
  data: BoardData,
  task: TaskDTO,
  agent: Pick<MemberDTO, "id" | "name" | "color" | "emoji">,
  fields: Partial<AgentRunDTO> = {},
): AgentRunDTO {
  const run = runOn(task, agent, fields);
  data.runs.push(run);
  return run;
}

/** A task as `GET /api/tasks/{id}` answers it: nothing on it but `more`. */
export function detailOf(task: TaskDTO, more: Partial<TaskDetailDTO> = {}): TaskDetailDTO {
  return {
    ...task,
    creator: null,
    links: { blockedBy: [], blocks: [] },
    parent: null,
    children: [],
    checklist: [],
    comments: [],
    activity: [],
    run: null,
    pastRuns: [],
    pastRunsTotal: 0,
    attachments: [],
    ...more,
  };
}

/** One request the component sent, with its body read as JSON. */
export type Sent = { method: string; path: string; query: URLSearchParams; body: unknown };

/** What a request is answered with. Nothing means 200 and `{}`. */
export type Answer = (sent: Sent) => { status?: number; body?: unknown } | undefined;

/** How a board is drawn beyond its data. */
export type Drawing = {
  /** Who is signed in. `ME` unless a test needs another name. */
  user?: SessionUser;
  /** Keep what this browser stored, as the next page of the same tab does. */
  keepStorage?: boolean;
};

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
  { user = ME, keepStorage = false }: Drawing = {},
) {
  const requests: Sent[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      /* A file goes as a form, which is kept as it was sent. */
      const form = init?.body instanceof FormData ? init.body : null;
      const raw = init?.body && !form ? String(init.body) : "";
      const sent: Sent = {
        method: init?.method ?? "GET",
        path: url.pathname,
        query: url.searchParams,
        body: form ?? (raw ? JSON.parse(raw) : undefined),
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

  /* The stream is the doorbell. Nobody rings it unless a test calls `ring()`. */
  const bells: ((event: MessageEvent) => void)[] = [];
  const voices: ((event: MessageEvent) => void)[] = [];
  vi.stubGlobal(
    "EventSource",
    class {
      onerror = null;
      onopen = null;
      addEventListener(kind: string, listener: (event: MessageEvent) => void) {
        if (kind === "change") bells.push(listener);
        if (kind === "presence") voices.push(listener);
      }
      close() {}
    },
  );

  /* The last view a person opened is kept per browser, and one test must not
     open on the view another left. A test that draws the board again, as a
     reload would, keeps it on purpose. */
  if (!keepStorage) window.localStorage.clear();

  /* The page reads `?view=` once, as a load does. It is taken out of the
     address here so that the next test does not land on it. */
  const address = new URL(window.location.href);
  const initialView = address.searchParams.get("view");
  address.searchParams.delete("view");
  window.history.replaceState(null, "", address.toString());

  const screen = await render(
    <BoardProvider initial={data} user={user} initialView={initialView}>
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

  /* Somebody else wrote: the board and an open panel read again, and find
     whatever the test has put in `data` and `answer` since. */
  const ring = () => {
    const event = new MessageEvent("change", { data: JSON.stringify({ clientId: "elsewhere" }) });
    for (const bell of bells) bell(event);
  };

  /* Another tab said where it is, as the stream relays it. */
  const hear = (said: PresenceSaid) => {
    const event = new MessageEvent("presence", { data: JSON.stringify(said) });
    for (const voice of voices) voice(event);
  };

  return { screen, sent, ring, hear };
}
