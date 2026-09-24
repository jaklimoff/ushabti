"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, CLIENT_ID } from "@/lib/client";
import { cardItems, defaultCardView, mainBoardGroupById, readCardView } from "@/lib/card-view";
import type { CardItem } from "@/lib/card-view";
import { deletedSaid } from "@/lib/deleted";
import { sweepDrafts } from "@/lib/draft";
import {
  applyFilters,
  clashOf,
  clashSaid,
  EMPTY_FILTERS,
  mergeFilters,
  waitingTasks,
} from "@/lib/filters";
import {
  editorsOf,
  expirePresence,
  LISTEN_TOUCH_MS,
  mergePresence,
  peopleOn,
  type PresenceSaid,
  type Room,
} from "@/lib/presence";
import { rankBetween } from "@/lib/rank";
import type {
  AgentRunDTO,
  ArchivedTaskDTO,
  BoardData,
  CardView,
  FilterRule,
  PropertyDTO,
  PropertyType,
  RunControl,
  TaskDTO,
  TaskValue,
  ViewDTO,
  ViewFilters,
  ViewKind,
  ViewSort,
} from "@/lib/types";
import type { SessionUser } from "@/components/ui/UserMenu";
import { useToasts, type Notify, type Toast } from "@/components/ui/Toasts";

type Store = {
  data: BoardData;
  user: SessionUser;
  view: ViewDTO | null;
  groupProperty: PropertyDTO | null;
  /**
   * Every rule that hides a card on this screen: the view's, then mine.
   *
   * Everything that hides, counts, seeds or drops a column reads this one
   * answer. The two sets are told apart in the strip, where it matters which
   * of them a ✕ takes away, and nowhere else.
   */
  filters: ViewFilters;
  /** The rules of the view itself. Everybody on the board sees these. */
  viewFilters: ViewFilters;
  /** The rules I added to this view. Only I see them. */
  lens: ViewFilters;
  /**
   * The tasks that view shows. Everything that counts tasks reads this, so the
   * columns, the count in the strip and the empty state can never disagree.
   */
  visibleTasks: TaskDTO[];
  /** Writes the rules of the view. They save at once, like the grouping does. */
  setFilters: (rules: FilterRule[]) => Promise<void>;
  /** Writes my own rules on this view. They save at once, exactly as those do. */
  setLens: (rules: FilterRule[]) => Promise<void>;
  /** Takes my rules and my order off this view in one write. */
  clearLens: () => Promise<void>;
  /**
   * Puts my rules on the view, for everybody, and empties my lens. One write,
   * so the board never holds the same question twice.
   */
  promoteLens: () => Promise<void>;
  /**
   * The order this screen draws in — rows, or cards in a column — or null.
   * Mine while I have picked one, and the view's otherwise. Everything that
   * orders or holds still reads this one answer, so a board holds still only
   * for the person whose order it is.
   */
  sort: ViewSort | null;
  /** The order of the view itself. Everybody on the board sees it. */
  viewSort: ViewSort | null;
  /** The order I picked on this view. Only I see it. */
  lensSort: ViewSort | null;
  /** Writes my own order on this view, in my lens. Nobody else is told. */
  setSort: (sort: ViewSort | null) => Promise<void>;
  /** Writes the order of the view, for everybody. */
  setViewSort: (sort: ViewSort | null) => Promise<void>;
  /** Every row of the card, in order, with the property behind it. */
  cardItems: CardItem[];
  /** Arranges the card. It saves as you click; there is no Save button. */
  setCardView: (view: CardView) => Promise<void>;
  /** Back to the card the board draws when nobody has arranged one. */
  resetCardView: () => Promise<void>;
  /** The open run of a task, or null. One task holds one run at a time. */
  runOf: (taskId: string) => AgentRunDTO | null;
  /** Pause, resume or stop is a request. Take over ends the run at once. */
  controlRun: (runId: string, control: RunControl | "take_over") => Promise<void>;
  live: boolean;
  toasts: Toast[];
  setViewId: (id: string) => void;
  notify: Notify;
  refresh: () => Promise<void>;
  /**
   * Counts a write this tab sends by itself, past the store. A board read that
   * was already out is then dropped, as it is for the store's own writes.
   */
  wrote: () => void;
  /** Who else has which task open. Read it through `usePresence`. */
  presence: Presence;

  createTask: (input: {
    title: string;
    values?: Record<string, TaskValue>;
    afterId?: string | null;
    atTop?: boolean;
  }) => Promise<TaskDTO | null>;
  patchTask: (taskId: string, patch: { title?: string; description?: string }) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  /** Takes a task off every board and list. Everything on it stays. */
  archiveTask: (taskId: string) => Promise<void>;
  /**
   * Puts an archived task back where its rank says it belongs. It answers
   * whether it went through, because the archive page says so in words and a
   * row that failed must not read as one that went.
   */
  restoreTask: (taskId: string) => Promise<boolean>;
  /**
   * Puts a deleted task back, with its key, its rank and everything on it. It
   * answers whether it went through, for the same reason a put back from the
   * archive does: the drawer says so in words, and a row that failed must not
   * read as one that went.
   */
  undeleteTask: (taskId: string) => Promise<boolean>;
  /** Archives every live task in one column. A person's act, so it asks first. */
  archiveColumn: (propertyId: string | null, value: TaskValue) => Promise<number>;
  moveTask: (input: {
    taskId: string;
    beforeId: string | null;
    afterId: string | null;
    values?: Record<string, TaskValue>;
  }) => Promise<void>;
  /** Answers whether the write went through, so a caller that drew it early can put it right. */
  setValue: (taskId: string, propertyId: string, value: TaskValue) => Promise<boolean>;
  /**
   * Says that one task waits on another, or takes that back. `waitsId` is the
   * task that does the waiting.
   *
   * It lives here rather than in the panel because a write has to be counted:
   * a read of the board that went out before the click would otherwise land
   * on top of it and quietly take the chain glyph off again. It throws instead
   * of notifying, because a refused link — a circle — is answered in the row
   * the person is looking at, and not in a toast that goes in five seconds.
   */
  linkBlocker: (waitsId: string, blockerId: string, on: boolean) => Promise<void>;

  /**
   * The tasks picked for one change to all of them.
   *
   * It is `picked` and not `selected`, because "selected" already means the
   * one task the panel is open on. Only what this view draws is in here: a
   * card a filter hides leaves the count quietly, and leaves the write with
   * it, so the bar can never say three where the board shows two. A filter
   * hides a card; it does not unpick it.
   */
  picked: string[];
  /**
   * Whether one card is picked. Every card on the board asks this on every
   * render, so it is a set and not a walk of the list: two hundred picks would
   * otherwise cost forty thousand comparisons a draw.
   */
  isPicked: (taskId: string) => boolean;
  /** Picks one card, or puts it back. The next range is measured from it. */
  togglePick: (taskId: string) => void;
  /**
   * Picks every card between the last one picked and this one. The run is
   * given as the column's own cards, top to bottom, because a range is a
   * range of the screen and only the column knows its order. With the last
   * pick somewhere else, there is no run: this one card is picked instead.
   */
  pickTo: (taskId: string, columnTaskIds: string[]) => void;
  /** Nothing is picked. Escape, the ✕ and a change of view all end here. */
  clearPicks: () => void;
  /** Sets one property on every picked task, in one call. */
  setPickedValue: (propertyId: string, value: TaskValue) => Promise<void>;
  /**
   * Archives every picked task, in one call, and ends the pick once it has
   * gone through. It answers how many went, because the bar says so in words
   * and a call that archived nothing must not read as one that did.
   */
  archivePicked: () => Promise<number>;
  /** Feeds the checklist and comment counts of an open task back to its card. */
  syncTaskCounts: (
    taskId: string,
    counts: { checklistTotal: number; checklistDone: number; commentCount: number },
  ) => void;

  /** A board needs a property for its columns. A list does not. */
  createView: (name: string, kind: ViewKind, groupById: string | null) => Promise<void>;
  updateView: (
    viewId: string,
    patch: {
      name?: string;
      kind?: ViewKind;
      groupById?: string | null;
      filters?: ViewFilters;
      sort?: ViewSort | null;
    },
  ) => Promise<void>;
  deleteView: (viewId: string) => Promise<void>;
  /**
   * Names the main view: the one a board opens on, and the one that cannot be
   * deleted. Naming one takes the word off the other, here as on the server.
   */
  setMainView: (viewId: string) => Promise<void>;
  /**
   * Puts one view where another one sits. A drag names the view it landed on,
   * not a rank: the strip and the settings page then say the same thing in the
   * same words, and `landedAfter` is the one place that works the neighbour
   * out.
   */
  moveView: (viewId: string, overId: string) => Promise<void>;

  addOption: (propertyId: string, name: string) => Promise<string | null>;
  patchOption: (
    optionId: string,
    patch: { name?: string; color?: string; afterId?: string | null },
  ) => Promise<void>;
  /**
   * Puts one option where another one of the same property sits. Settings
   * names the chip it landed on, and the move is the one a column drag makes.
   */
  moveOption: (optionId: string, overId: string) => Promise<void>;
  deleteOption: (optionId: string) => Promise<void>;
  addProperty: (name: string, type: PropertyType, options?: string[]) => Promise<void>;
  patchProperty: (propertyId: string, patch: { name?: string }) => Promise<void>;
  /**
   * Puts one property where another one sits. A drag names the property it
   * landed on, not a rank, and the neighbour is worked out by the same
   * `landedAfter` a view's drag uses.
   */
  moveProperty: (propertyId: string, overId: string) => Promise<void>;
  deleteProperty: (propertyId: string) => Promise<void>;
};

/** The parts of a task patch that an archived task still carries. */
function archivedPart(patch: Partial<TaskDTO>): Partial<ArchivedTaskDTO> {
  const next: Partial<ArchivedTaskDTO> = {};
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.position !== undefined) next.position = patch.position;
  return next;
}

/**
 * Where a dragged row lands. A drag names what it landed on, so this is the
 * one place that works the neighbour out: the list in its new order, and the
 * row the dragged one now sits behind. That id is null at the front of the
 * list; the whole answer is null when the drag changed nothing.
 */
function landedAfter<T extends { id: string }>(
  list: T[],
  id: string,
  overId: string,
): { ordered: T[]; afterId: string | null } | null {
  const from = list.findIndex((item) => item.id === id);
  const to = list.findIndex((item) => item.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  const ordered = list.filter((item) => item.id !== id);
  ordered.splice(to, 0, list[from]);
  return { ordered, afterId: ordered[to - 1]?.id ?? null };
}

const BoardContext = createContext<Store | null>(null);

/*
 * Which task every other tab on this project has open.
 *
 * It lives outside React state on purpose. A tab says where it is every 25
 * seconds, and holding the room in the store would draw the whole board again
 * each time; only the faces in a panel header need to hear it. Nothing here
 * reads the board, because a panel opening somewhere is not a change to it.
 */
type Presence = {
  watch: (tell: () => void) => () => void;
  room: () => Room;
  /** Says what this tab has open. A later `field` is how a box says it is being typed in. */
  say: (taskId: string | null, field: string | null) => void;
  /** Takes one message off the stream. */
  heard: (said: PresenceSaid) => void;
  /** Says it again, so the tabs that are already here answer a new stream. */
  announce: () => void;
  /** The lease: says it again while a task is open, and drops who went quiet. */
  tick: () => void;
  touch: () => void;
};

function makePresence(projectId: string): Presence {
  let room: Room = {};
  let mine: { taskId: string | null; field: string | null } = { taskId: null, field: null };
  const watchers = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let line: Promise<unknown> = Promise.resolve();

  const tell = () => {
    for (const fn of watchers) fn();
  };

  /*
   * One send at a time, and each sends what is true when its turn comes. A
   * panel that moves from one task to the next closes one and opens the other
   * in the same breath; two requests in flight could land the wrong way round
   * and leave the face on nothing.
   */
  const send = (after: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      line = line.then(() =>
        api.post(`/api/projects/${projectId}/presence`, mine).catch(() => undefined),
      );
    }, after);
  };

  return {
    watch(fn) {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    room: () => room,
    say(taskId, field) {
      if (mine.taskId === taskId && mine.field === field) return;
      mine = { taskId, field };
      send(0);
    },
    heard(said) {
      if (said.clientId === CLIENT_ID) {
        /* A stream this tab has already replaced can say goodbye late, after
           a blip, and the other tabs would drop a face that is still here. */
        if (said.taskId === null && mine.taskId) send(300);
        return;
      }
      const merged = mergePresence(room, said);
      room = merged.room;
      tell();
      /* A stranger is a tab that just came, so it knows nobody. Answering
         once teaches it the room in a second rather than in 25. A tab with
         nothing open has nothing to teach. The short wait folds the answers
         to several strangers into one. */
      if (merged.stranger && mine.taskId) send(300);
    },
    announce: () => send(0),
    tick() {
      const kept = expirePresence(room);
      if (kept !== room) {
        room = kept;
        tell();
      }
    },
    touch() {
      if (mine.taskId) send(0);
    },
  };
}

/**
 * The people other than me who have this task open, a way to say which field
 * I am in, and who else is in a field. Mounting it says the task is open;
 * unmounting says it closed.
 */
export function usePresence(taskId: string) {
  const { presence, data, user } = useBoard();
  const room = useSyncExternalStore(presence.watch, presence.room, emptyRoom);
  /* A field that closes as the panel closes says so after the panel said
     goodbye, and would open the task again on every other screen. */
  const open = useRef<string | null>(null);

  useEffect(() => {
    open.current = taskId;
    presence.say(taskId, null);
    return () => {
      open.current = null;
      presence.say(null, null);
    };
  }, [presence, taskId]);

  const faces = useMemo(
    () =>
      peopleOn(room, taskId, user.id)
        .map((id) => data.members.find((m) => m.id === id))
        .filter((m) => m !== undefined),
    [data.members, room, taskId, user.id],
  );
  const inField = useCallback(
    (field: string | null) => {
      if (open.current === taskId) presence.say(taskId, field);
    },
    [presence, taskId],
  );
  /** Who else is typing in one field of this task, as their names. */
  const editing = useCallback(
    (field: string) =>
      editorsOf(room, taskId, field, user.id)
        .map((id) => data.members.find((m) => m.id === id)?.name)
        .filter((name) => name !== undefined),
    [data.members, room, taskId, user.id],
  );
  return { faces, inField, editing };
}

const noRoom: Room = {};
const emptyRoom = () => noRoom;

export function useBoard(): Store {
  const store = useContext(BoardContext);
  if (!store) throw new Error("useBoard must run inside BoardProvider.");
  return store;
}

const VIEW_KEY = "ushabti:view:";

/*
 * Which view each project was last left on. That is one person’s answer about
 * their own screen, so it is kept in their browser and not on the board
 * everybody shares — which makes it a store outside React, and React reads it
 * as one. The page is drawn on the server first, where no browser answers, so
 * the server’s answer is "nothing yet" and the browser’s arrives the moment it
 * takes over. Reading it in an effect instead meant writing state from one.
 *
 * The copy in memory is what answers in private mode, where the browser keeps
 * nothing: picking a view still holds for as long as the tab is open.
 */
const lastView = new Map<string, string | null>();
const lastViewWatchers = new Set<() => void>();

function readLastView(projectId: string): string | null {
  if (!lastView.has(projectId)) {
    try {
      lastView.set(projectId, window.localStorage.getItem(VIEW_KEY + projectId));
    } catch {
      lastView.set(projectId, null); /* private mode */
    }
  }
  return lastView.get(projectId) ?? null;
}

function writeLastView(projectId: string, id: string) {
  lastView.set(projectId, id);
  try {
    window.localStorage.setItem(VIEW_KEY + projectId, id);
  } catch {
    /* private mode */
  }
  for (const tell of lastViewWatchers) tell();
}

function watchLastView(tell: () => void) {
  lastViewWatchers.add(tell);
  return () => {
    lastViewWatchers.delete(tell);
  };
}

/** On the server nobody has picked one, so the board opens on the main view. */
const noLastView = () => null;

export function BoardProvider({
  initial,
  user,
  children,
}: {
  initial: BoardData;
  user: SessionUser;
  children: React.ReactNode;
}) {
  const [data, setData] = useState<BoardData>(initial);
  const [live, setLive] = useState(false);
  const { toasts, notify } = useToasts();
  const router = useRouter();
  const projectId = data.project.id;

  /* --- the last view of this project, and the main one behind it ------- */
  const lastViewId = useSyncExternalStore(
    watchLastView,
    useCallback(() => readLastView(projectId), [projectId]),
    noLastView,
  );
  const viewId =
    lastViewId || (initial.views.find((v) => v.isDefault)?.id ?? initial.views[0]?.id ?? "");

  /* What is picked belongs to the board on screen, so moving to another view
     ends it. The ids are kept as they were picked, and what the view draws is
     worked out below. */
  const [pickedRaw, setPickedRaw] = useState<string[]>([]);
  /* The card the next range is measured from: the last one picked by hand. */
  const anchor = useRef<string | null>(null);

  const setViewId = useCallback(
    (id: string) => {
      setPickedRaw([]);
      anchor.current = null;
      writeLastView(projectId, id);
    },
    [projectId],
  );

  /*
   * Every write this tab makes, counted. A read that was already in flight when
   * one went out answers with the board as it was before, and putting that on
   * screen quietly undoes the click that just happened. The stream asks for a
   * board the moment it connects, so the window is widest right after a page
   * loads — which is exactly when somebody clicks.
   */
  const writes = useRef(0);
  const wrote = useCallback(() => {
    writes.current += 1;
  }, []);

  const refresh = useCallback(async () => {
    const at = writes.current;
    try {
      const fresh = await api.get<BoardData>(`/api/projects/${projectId}/board`);
      if (writes.current !== at) return;
      setData(fresh);
      /* The answer names every task this project still has, so it is the one
         place that can say which unsent notes have nothing left to sit on. */
      sweepDrafts(projectId, [...fresh.tasks.map((t) => t.id), ...fresh.archived.map((t) => t.id)]);
    } catch (err) {
      // The project is gone, or this person was removed from it.
      if (err instanceof ApiError && err.status === 404) router.push("/projects");
    }
  }, [projectId, router]);

  /*
   * The stream must outlive every re-render, so the effect below holds the
   * project id and nothing else. It used to depend on `refresh`, which depends
   * on the router, which gets a new identity whenever the route's shape
   * changes: the EventSource then closed and reopened, and any broadcast that
   * arrived in the gap was gone for good, because SSE does not replay.
   */
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const presence = useMemo(() => makePresence(projectId), [projectId]);
  useEffect(() => {
    /* The sweep runs more often than the touch, so a tab that died goes
       within a few seconds of its lease, not up to a whole touch later. */
    const sweep = setInterval(presence.tick, 5_000);
    const touch = setInterval(presence.touch, LISTEN_TOUCH_MS);
    return () => {
      clearInterval(sweep);
      clearInterval(touch);
    };
  }, [presence]);

  /* --- live updates from the other people on the board ---------------- */
  useEffect(() => {
    /* An EventSource cannot set a header, so the tab names itself in the
       address. The stream says goodbye for it when it closes. */
    const source = new EventSource(`/api/projects/${projectId}/stream?client=${CLIENT_ID}`);
    let timer: ReturnType<typeof setTimeout> | null = null;

    /*
     * Server-sent events have no replay, so everything that happened between
     * the server rendering this board and the stream opening is invisible.
     * That gap is small but real, and it grows whenever hydration is slower —
     * a loading boundary, a cold cache, a slow phone. Ask once on connect, and
     * the same line re-syncs after every reconnect: a network blip, a laptop
     * waking up.
     */
    const opened = () => {
      setLive(true);
      void refreshRef.current();
      presence.announce();
    };

    source.addEventListener("ready", opened);
    source.addEventListener("change", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { clientId?: string };
      if (payload.clientId === CLIENT_ID) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refreshRef.current();
        window.dispatchEvent(new CustomEvent("ushabti:remote-change"));
      }, 140);
    });
    /* Presence carries its data and changes nothing on the board, so it
       never reads the board again. */
    source.addEventListener("presence", (event) => {
      presence.heard(JSON.parse((event as MessageEvent).data) as PresenceSaid);
    });
    source.onerror = () => setLive(false);
    source.onopen = opened;

    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [presence, projectId]);

  /* --- derived -------------------------------------------------------- */
  const view = useMemo(
    () => data.views.find((v) => v.id === viewId) ?? data.views[0] ?? null,
    [data.views, viewId],
  );

  const groupProperty = useMemo(
    () => (view?.groupById ? (data.properties.find((p) => p.id === view.groupById) ?? null) : null),
    [data.properties, view],
  );

  const viewFilters = view?.filters ?? EMPTY_FILTERS;
  const lens = view?.lens ?? EMPTY_FILTERS;
  /* One answer for the screen. A filter narrows and never widens, so mine only
     goes on the end of the view's. */
  const filters = useMemo(() => mergeFilters(viewFilters, lens), [viewFilters, lens]);
  const viewSort = view?.sort ?? null;
  const lensSort = view?.lensSort ?? null;
  /* Mine wins while it exists, exactly as the lens is the last word on what
     this screen shows. */
  const sort = lensSort ?? viewSort;

  /*
   * The card view is read afresh here, exactly as the server reads it: a row
   * that names a property somebody has just deleted must stop holding a place
   * on the card at once, and not when the next board arrives.
   */
  const defaultGroupById =
    (data.views.find((v) => v.isDefault) ?? data.views[0])?.groupById ?? null;

  const cardView = useMemo(
    () => readCardView(data.cardView, data.properties, defaultGroupById),
    [data.cardView, data.properties, defaultGroupById],
  );

  const items = useMemo(() => cardItems(cardView, data.properties), [cardView, data.properties]);

  /* The day comes off the board answer and never off this browser's clock,
     so a relative date rule draws the same cards here as it did on the
     server. A board left open over midnight keeps yesterday until the next
     read, which is the price of the two renders agreeing. "Me" is read as
     the person at this screen, so one shared view is each viewer's own.
     "Agent waiting" reads the open runs of the same answer, so an answered
     question takes the card out on the read the answer rings for. */
  const waiting = useMemo(() => waitingTasks(data.runs), [data.runs]);
  const visibleTasks = useMemo(
    () => applyFilters(data.tasks, filters, data.properties, data.today, user.id, waiting),
    [data.properties, data.tasks, data.today, filters, user.id, waiting],
  );

  /*
   * Only what the view draws. Everything that counts the picks, writes them or
   * says how many there are reads this one answer, so the bar, the border on
   * the card and the ids the route is sent can never disagree — exactly as
   * `visibleTasks` is the one answer about the cards themselves.
   */
  const pickedHere = useMemo(() => {
    if (pickedRaw.length === 0) return pickedRaw;
    const drawn = new Set(visibleTasks.map((t) => t.id));
    return pickedRaw.filter((id) => drawn.has(id));
  }, [pickedRaw, visibleTasks]);

  const pickedSet = useMemo(() => new Set(pickedHere), [pickedHere]);
  const isPicked = useCallback<Store["isPicked"]>((taskId) => pickedSet.has(taskId), [pickedSet]);

  const togglePick = useCallback<Store["togglePick"]>((taskId) => {
    anchor.current = taskId;
    setPickedRaw((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
  }, []);

  const pickTo = useCallback<Store["pickTo"]>((taskId, columnTaskIds) => {
    const from = anchor.current ? columnTaskIds.indexOf(anchor.current) : -1;
    const to = columnTaskIds.indexOf(taskId);
    /* The last pick is in another column, or gone. A run across two columns
       is two runs, so this picks the one card and starts again from it. */
    if (from < 0 || to < 0) {
      anchor.current = taskId;
      setPickedRaw((current) => (current.includes(taskId) ? current : [...current, taskId]));
      return;
    }
    /* The anchor stays where it is, so a second Shift-click measures the run
       from the same card rather than from the end of the last one. */
    const run = columnTaskIds.slice(Math.min(from, to), Math.max(from, to) + 1);
    setPickedRaw((current) => [...current, ...run.filter((id) => !current.includes(id))]);
  }, []);

  const clearPicks = useCallback<Store["clearPicks"]>(() => {
    anchor.current = null;
    setPickedRaw([]);
  }, []);

  const runsByTask = useMemo(() => {
    const map = new Map<string, AgentRunDTO>();
    for (const run of data.runs) map.set(run.taskId, run);
    return map;
  }, [data.runs]);

  const runOf = useCallback<Store["runOf"]>(
    (taskId) => runsByTask.get(taskId) ?? null,
    [runsByTask],
  );

  /* --- helpers -------------------------------------------------------- */
  /*
   * Both lists, because a title and a description are the two things an
   * archived task still carries — and the search row draws them. A tab skips
   * its own broadcast, so nothing else would correct a rename made here.
   */
  const patchLocalTask = useCallback((taskId: string, patch: Partial<TaskDTO>) => {
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      archived: current.archived.map((t) =>
        t.id === taskId ? { ...t, ...archivedPart(patch) } : t,
      ),
    }));
  }, []);

  /*
   * The refresh corrects the board, which is all most writes draw early. A
   * write that is drawn somewhere else as well — the panel of an archived task
   * has no card — needs to hear that it was refused, so the answer says so.
   */
  const guarded = useCallback(
    async (work: () => Promise<void>): Promise<boolean> => {
      wrote();
      try {
        await work();
        return true;
      } catch (err) {
        notify(err instanceof Error ? err.message : "The change did not save.");
        await refresh();
        return false;
      }
    },
    [notify, refresh, wrote],
  );

  /* --- tasks ---------------------------------------------------------- */
  /*
   * Two questions about a write that can free a card which is not the card
   * being written.
   *
   * What a task waits on is worked out on the server, because over is a rule
   * about another task — archived, or holding the one option this project
   * calls done. So the browser cannot see that a task somebody just archived
   * has stopped holding another one up, and the write has to be followed by a
   * read of the board.
   *
   * These two say when that can have happened, so the read is asked for only
   * then. A board with no links, and a project that never named an option,
   * pay nothing.
   */
  const holdsUpACard = useCallback(
    (taskId: string) => {
      const key = data.tasks.find((t) => t.id === taskId)?.key;
      return !!key && data.tasks.some((t) => t.blockedBy.includes(key));
    },
    [data.tasks],
  );

  const saysDone = useCallback(
    (propertyId: string) => data.project.doneWhen?.propertyId === propertyId,
    [data.project.doneWhen],
  );

  const createTask = useCallback<Store["createTask"]>(
    async (input) => {
      wrote();
      try {
        /* What the route really answers: the row it wrote, and the key it
           wears. Not a whole card — calling it one is how a card reached the
           board without the fields that are counted or joined. */
        const { task } = await api.post<{
          task: Pick<
            TaskDTO,
            | "id"
            | "number"
            | "key"
            | "title"
            | "description"
            | "position"
            | "createdAt"
            | "updatedAt"
          >;
        }>(`/api/projects/${projectId}/tasks`, {
          title: input.title,
          values: input.values ?? {},
          afterId: input.afterId ?? null,
          atTop: input.atTop ?? false,
        });
        /* The route answers with the row it wrote and the key it wears, and
           nothing that is counted or joined. A task a moment old has none of
           those: no checklist, no comments, and nothing to wait on. */
        const complete: TaskDTO = {
          ...task,
          values: input.values ?? {},
          checklistTotal: 0,
          checklistDone: 0,
          commentCount: 0,
          blockedBy: [],
          description: task.description ?? "",
          archivedAt: null,
        };
        setData((current) => ({ ...current, tasks: [...current.tasks, complete] }));
        return complete;
      } catch (err) {
        notify(err instanceof Error ? err.message : "The task did not save.");
        return null;
      }
    },
    [notify, projectId, wrote],
  );

  const patchTask = useCallback<Store["patchTask"]>(
    async (taskId, patch) => {
      patchLocalTask(taskId, patch);
      await guarded(async () => {
        await api.patch(`/api/tasks/${taskId}`, patch);
      });
    },
    [guarded, patchLocalTask],
  );

  /*
   * This one waits for the board rather than drawing the answer itself: a
   * deleted task is on no list the browser holds, so there is nothing here to
   * draw it from. It comes back live or archived — whichever it was — and only the
   * server knows which.
   */
  const undeleteTask = useCallback<Store["undeleteTask"]>(
    async (taskId) =>
      guarded(async () => {
        await api.post(`/api/tasks/${taskId}/restore`, {});
        await refresh();
      }),
    [guarded, refresh],
  );

  /*
   * A delete is the one press on this board with a way back. The toast
   * carries the quick way, Undo, and names the slow one, the archive page, with
   * the days the server counted — the toast goes in seconds and the archive
   * page does not. It is written out here rather than through `guarded`, which throws the
   * answer away, and the answer is the only place the window is.
   *
   * Undo is tied to the id read here, not to whatever is open when it is
   * pressed, so a press after somebody moved on still brings back this task.
   */
  const deleteTask = useCallback<Store["deleteTask"]>(
    async (taskId) => {
      /* The key, read before the row goes. By the time the answer lands there
         is nothing left in either list to read it off. */
      const key =
        data.tasks.find((t) => t.id === taskId)?.key ??
        data.archived.find((t) => t.id === taskId)?.key ??
        null;
      const holdsUp = holdsUpACard(taskId);

      setData((current) => ({
        ...current,
        tasks: current.tasks.filter((t) => t.id !== taskId),
        archived: current.archived.filter((t) => t.id !== taskId),
      }));

      wrote();
      try {
        const said = await api.del<{ goesAt?: string }>(`/api/tasks/${taskId}`);
        if (key)
          notify(deletedSaid(key, said?.goesAt ?? null), "info", {
            label: "Undo",
            run: () => void undeleteTask(taskId),
          });
        /* A deleted task is on no board, so it blocks nothing any more. */
        if (holdsUp) await refresh();
      } catch (err) {
        notify(err instanceof Error ? err.message : "The change did not save.");
        await refresh();
      }
    },
    [data.archived, data.tasks, holdsUpACard, notify, refresh, undeleteTask, wrote],
  );

  /* The card leaves the board at once and joins the archived list, so a search
     finds it and its panel stays open on the row that puts it back. */
  const archiveTask = useCallback<Store["archiveTask"]>(
    async (taskId) => {
      const at = new Date().toISOString();
      /* Read before the row leaves the list it is read from. */
      const holdsUp = holdsUpACard(taskId);
      setData((current) => {
        const task = current.tasks.find((t) => t.id === taskId);
        if (!task) return current;
        return {
          ...current,
          tasks: current.tasks.filter((t) => t.id !== taskId),
          archived: [
            ...current.archived,
            {
              id: task.id,
              number: task.number,
              key: task.key,
              title: task.title,
              description: task.description,
              position: task.position,
              archivedAt: at,
            },
          ],
        };
      });
      await guarded(async () => {
        await api.post(`/api/tasks/${taskId}/archive`, {});
      });
      /* An archived task is over, whatever else the project calls over, so
         every card that was waiting on this one is free now. */
      if (holdsUp) await refresh();
    },
    [guarded, holdsUpACard, refresh],
  );

  /*
   * This one waits for the board rather than drawing the answer itself. An
   * archived task is carried light, without the values and the counts a card
   * needs, and it returns to the rank it never lost — which only the server
   * knows. Taking it out of the archived list first would leave it in neither
   * list for a moment, and a task in neither list is a task that was removed,
   * which closes its panel.
   */
  const restoreTask = useCallback<Store["restoreTask"]>(
    async (taskId) =>
      guarded(async () => {
        await api.del(`/api/tasks/${taskId}/archive`);
        await refresh();
      }),
    [guarded, refresh],
  );

  /* How many cards went is the server's answer, because the sweep names a
     value and the board is only drawing part of the project. */
  const archiveColumn = useCallback<Store["archiveColumn"]>(
    async (propertyId, value) => {
      if (!propertyId) return 0;
      wrote();
      try {
        const res = await api.post<{ archived: number }>(`/api/projects/${projectId}/archive`, {
          propertyId,
          value,
        });
        await refresh();
        return res.archived;
      } catch (err) {
        notify(err instanceof Error ? err.message : "The column did not archive.");
        await refresh();
        return 0;
      }
    },
    [notify, projectId, refresh, wrote],
  );

  const moveTask = useCallback<Store["moveTask"]>(
    async ({ taskId, beforeId, afterId, values }) => {
      setData((current) => {
        const ordered = [...current.tasks].sort((a, b) => (a.position < b.position ? -1 : 1));
        const others = ordered.filter((t) => t.id !== taskId);
        let lower: string | null = null;
        let upper: string | null = null;
        if (beforeId) {
          const i = others.findIndex((t) => t.id === beforeId);
          if (i >= 0) {
            lower = others[i - 1]?.position ?? null;
            upper = others[i].position;
          }
        } else if (afterId) {
          const i = others.findIndex((t) => t.id === afterId);
          if (i >= 0) {
            lower = others[i].position;
            upper = others[i + 1]?.position ?? null;
          }
        } else {
          lower = others.at(-1)?.position ?? null;
        }
        const position = rankBetween(lower, upper);
        return {
          ...current,
          tasks: current.tasks.map((t) =>
            t.id === taskId ? { ...t, position, values: { ...t.values, ...(values ?? {}) } } : t,
          ),
        };
      });

      await guarded(async () => {
        const res = await api.post<{ position: string }>(`/api/tasks/${taskId}/move`, {
          beforeId,
          afterId,
          values: values ?? {},
        });
        patchLocalTask(taskId, { position: res.position });
      });
      /* A card carried into another column writes that column's value, which
         may be the one the project calls done. */
      if (Object.keys(values ?? {}).some(saysDone)) await refresh();
    },
    [guarded, patchLocalTask, refresh, saysDone],
  );

  const setValue = useCallback<Store["setValue"]>(
    async (taskId, propertyId, value) => {
      setData((current) => ({
        ...current,
        tasks: current.tasks.map((t) =>
          t.id === taskId ? { ...t, values: { ...t.values, [propertyId]: value } } : t,
        ),
      }));
      const saved = await guarded(async () => {
        await api.put(`/api/tasks/${taskId}/values/${propertyId}`, { value });
      });
      if (saved && saysDone(propertyId)) await refresh();
      return saved;
    },
    [guarded, refresh, saysDone],
  );

  const linkBlocker = useCallback<Store["linkBlocker"]>(
    async (waitsId, blockerId, on) => {
      wrote();
      if (on) await api.post(`/api/tasks/${waitsId}/blockers`, { blockerId });
      else await api.del(`/api/tasks/${waitsId}/blockers/${blockerId}`);
      /* What a card waits on is worked out on the server, so the board is
         read again rather than patched here. */
      await refresh();
    },
    [refresh, wrote],
  );

  /*
   * One call, not one for each card. Ten calls coerce the value ten times,
   * ring the doorbell ten times, and can stop halfway with nothing on screen
   * saying where. The cards move at once and the refusal puts them back, like
   * every other write here.
   *
   * The picks stand afterwards. Setting a second property on the same cards is
   * the next thing a person does, and clearing them would take it away.
   */
  const setPickedValue = useCallback<Store["setPickedValue"]>(
    async (propertyId, value) => {
      const ids = pickedHere;
      if (ids.length === 0) return;
      const wanted = new Set(ids);
      setData((current) => ({
        ...current,
        tasks: current.tasks.map((t) =>
          wanted.has(t.id) ? { ...t, values: { ...t.values, [propertyId]: value } } : t,
        ),
      }));
      await guarded(async () => {
        await api.post(`/api/projects/${projectId}/tasks/values`, {
          taskIds: ids,
          propertyId,
          value,
        });
      });
      if (saysDone(propertyId)) await refresh();
    },
    [guarded, pickedHere, projectId, refresh, saysDone],
  );

  /*
   * One call, not one for each card, for the same reason a bulk set is one.
   *
   * The pick ends on the answer and not before it. A refusal — a task somebody
   * else deleted a moment ago, a socket that dropped — leaves the picks where
   * they were, so the toast is the whole of what went wrong and nobody has to
   * pick twenty cards again to try it. Once it goes through the pick ends,
   * unlike a set: the cards are off the board, so a bar still counting them
   * would count what nobody can see. The count is the server's, because it
   * archives only what was still live.
   */
  const archivePicked = useCallback<Store["archivePicked"]>(async () => {
    const ids = pickedHere;
    if (ids.length === 0) return 0;
    wrote();
    try {
      const res = await api.post<{ archived: number }>(`/api/projects/${projectId}/archive`, {
        taskIds: ids,
      });
      clearPicks();
      await refresh();
      return res.archived;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Those tasks did not archive.");
      await refresh();
      return 0;
    }
  }, [clearPicks, notify, pickedHere, projectId, refresh, wrote]);

  const controlRun = useCallback<Store["controlRun"]>(
    async (runId, control) => {
      try {
        await api.post(`/api/runs/${runId}/control`, { control });
        await refresh();
      } catch (err) {
        notify(err instanceof Error ? err.message : "The agent did not hear that.");
      }
    },
    [notify, refresh],
  );

  /* Only the live list: an archived task carries no counts to go stale. */
  const syncTaskCounts = useCallback<Store["syncTaskCounts"]>((taskId, counts) => {
    setData((current) => {
      const task = current.tasks.find((t) => t.id === taskId);
      if (
        !task ||
        (task.checklistTotal === counts.checklistTotal &&
          task.checklistDone === counts.checklistDone &&
          task.commentCount === counts.commentCount)
      ) {
        return current;
      }
      return {
        ...current,
        tasks: current.tasks.map((t) => (t.id === taskId ? { ...t, ...counts } : t)),
      };
    });
  }, []);

  /* --- views ---------------------------------------------------------- */
  const createView = useCallback<Store["createView"]>(
    async (name, kind, groupById) => {
      wrote();
      try {
        const { view: created } = await api.post<{ view: ViewDTO }>(
          `/api/projects/${projectId}/views`,
          { name, kind, groupById },
        );
        setData((current) => ({ ...current, views: [...current.views, created] }));
        setViewId(created.id);
      } catch (err) {
        notify(err instanceof Error ? err.message : "The view did not save.");
      }
    },
    [notify, projectId, setViewId, wrote],
  );

  const updateView = useCallback<Store["updateView"]>(
    async (id, patch) => {
      setData((current) => ({
        ...current,
        views: current.views.map((v) => (v.id === id ? { ...v, ...patch } : v)),
      }));
      await guarded(async () => {
        await api.patch(`/api/views/${id}`, patch);
      });
    },
    [guarded],
  );

  const setFilters = useCallback<Store["setFilters"]>(
    async (rules) => {
      if (!view) return;
      await updateView(view.id, { filters: { rules } });
    },
    [updateView, view],
  );

  /*
   * A lens is written like a filter and broadcast like nothing at all: it
   * changes one screen, so no other browser is told. The board still redraws
   * here at once, because the view it belongs to is carrying it.
   *
   * The route puts the whole lens, so my rules and my order always go
   * together: a write of one that left the other out would take it away.
   */
  const putLens = useCallback(
    async (id: string, rules: FilterRule[], lensSort: ViewSort | null) => {
      setData((current) => ({
        ...current,
        views: current.views.map((v) => (v.id === id ? { ...v, lens: { rules }, lensSort } : v)),
      }));
      await guarded(async () => {
        await api.put(`/api/views/${id}/lens`, { filters: { rules }, sort: lensSort });
      });
    },
    [guarded],
  );

  const setLens = useCallback<Store["setLens"]>(
    async (rules) => {
      if (!view) return;
      await putLens(view.id, rules, view.lensSort);
    },
    [putLens, view],
  );

  /*
   * This one write waits for the answer and then reads the board, and it is
   * the only one that does.
   *
   * Every other write draws itself at once and puts itself back if the server
   * refuses, because the worst a refusal shows is the board the person meant.
   * A promote is refused for naming a property the view already filters, so
   * drawing it first shows two chips that fight each other over an emptied
   * board — the very screen the refusal exists to prevent — for as long as the
   * round trip takes. The toast then arrives beside a board that has moved.
   */
  const promoteLens = useCallback<Store["promoteLens"]>(async () => {
    if (!view) return;
    const id = view.id;

    /* What the route will say, said here first, so a clash this screen can
       already see costs nobody a round trip. */
    const clash = clashOf(view.filters, view.lens, data.properties);
    if (clash) return notify(clashSaid(clash));

    await guarded(async () => {
      await api.post(`/api/views/${id}/lens/promote`);
      /* The board comes back from the server rather than being worked out
         here. The joining is the same, but a set made before the write would
         be written over a board that arrived while the write was in flight.
         Nothing flashes, because this write already waited for its answer. */
      await refresh();
    });
  }, [data.properties, guarded, notify, refresh, view]);

  const clearLens = useCallback<Store["clearLens"]>(async () => {
    if (!view) return;
    await putLens(view.id, [], null);
  }, [putLens, view]);

  const setSort = useCallback<Store["setSort"]>(
    async (next) => {
      if (!view) return;
      await putLens(view.id, view.lens.rules, next);
    },
    [putLens, view],
  );

  const setViewSort = useCallback<Store["setViewSort"]>(
    async (next) => {
      if (!view) return;
      await updateView(view.id, { sort: next });
    },
    [updateView, view],
  );

  /* --- the card ------------------------------------------------------- */
  const setCardView = useCallback<Store["setCardView"]>(
    async (next) => {
      setData((current) => ({ ...current, cardView: next }));
      await guarded(async () => {
        await api.patch(`/api/projects/${projectId}/card-view`, { cardView: next });
      });
    },
    [guarded, projectId],
  );

  const resetCardView = useCallback<Store["resetCardView"]>(async () => {
    setData((current) => ({
      ...current,
      cardView: defaultCardView(current.properties, mainBoardGroupById(current.views)),
    }));
    await guarded(async () => {
      await api.patch(`/api/projects/${projectId}/card-view`, { cardView: null });
    });
  }, [guarded, projectId]);

  const deleteView = useCallback<Store["deleteView"]>(
    async (id) => {
      const remaining = data.views.filter((v) => v.id !== id);
      setData((current) => ({ ...current, views: remaining }));
      if (viewId === id) setViewId(remaining[0]?.id ?? "");
      await guarded(async () => {
        await api.del(`/api/views/${id}`);
      });
    },
    [data.views, guarded, setViewId, viewId],
  );

  const setMainView = useCallback<Store["setMainView"]>(
    async (id) => {
      setData((current) => ({
        ...current,
        views: current.views.map((v) => ({ ...v, isDefault: v.id === id })),
      }));
      await guarded(async () => {
        await api.patch(`/api/views/${id}`, { isDefault: true });
      });
    },
    [guarded],
  );

  /*
   * The order of the views is the order of the strip, so the answer is worked
   * out here and drawn at once. The board is fetched again only if the write
   * fails.
   */
  const moveView = useCallback<Store["moveView"]>(
    async (id, overId) => {
      const landed = landedAfter(data.views, id, overId);
      if (!landed) return;

      setData((current) => ({ ...current, views: landed.ordered }));
      await guarded(async () => {
        await api.patch(`/api/views/${id}`, { afterId: landed.afterId });
      });
    },
    [data.views, guarded],
  );

  /* --- properties and options ----------------------------------------- */
  const addOption = useCallback<Store["addOption"]>(
    async (propertyId, name) => {
      wrote();
      try {
        const { option } = await api.post<{ option: PropertyDTO["options"][number] }>(
          `/api/properties/${propertyId}/options`,
          { name },
        );
        setData((current) => ({
          ...current,
          properties: current.properties.map((p) =>
            p.id === propertyId ? { ...p, options: [...p.options, option] } : p,
          ),
        }));
        return option.id;
      } catch (err) {
        notify(err instanceof Error ? err.message : "The option did not save.");
        return null;
      }
    },
    [notify, wrote],
  );

  const patchOption = useCallback<Store["patchOption"]>(
    async (optionId, patch) => {
      if (patch.name !== undefined || patch.color !== undefined) {
        setData((current) => ({
          ...current,
          properties: current.properties.map((p) => ({
            ...p,
            options: p.options.map((o) =>
              o.id === optionId
                ? {
                    ...o,
                    ...(patch.name ? { name: patch.name } : {}),
                    ...(patch.color ? { color: patch.color } : {}),
                  }
                : o,
            ),
          })),
        }));
      }
      await guarded(async () => {
        await api.patch(`/api/options/${optionId}`, patch);
        if (patch.afterId !== undefined) await refresh();
      });
    },
    [guarded, refresh],
  );

  /* The order shows at once, in Settings and in every column grouped by the
     property, because both read the one list of options. */
  const moveOption = useCallback<Store["moveOption"]>(
    async (optionId, overId) => {
      const property = data.properties.find((p) => p.options.some((o) => o.id === optionId));
      if (!property) return;
      const landed = landedAfter(property.options, optionId, overId);
      if (!landed) return;

      setData((current) => ({
        ...current,
        properties: current.properties.map((p) =>
          p.id === property.id ? { ...p, options: landed.ordered } : p,
        ),
      }));
      await patchOption(optionId, { afterId: landed.afterId });
    },
    [data.properties, patchOption],
  );

  const deleteOption = useCallback<Store["deleteOption"]>(
    async (optionId) => {
      await guarded(async () => {
        await api.del(`/api/options/${optionId}`);
        await refresh();
      });
    },
    [guarded, refresh],
  );

  const addProperty = useCallback<Store["addProperty"]>(
    async (name, type, options) => {
      await guarded(async () => {
        await api.post(`/api/projects/${projectId}/properties`, { name, type, options });
        await refresh();
      });
    },
    [guarded, projectId, refresh],
  );

  const patchProperty = useCallback<Store["patchProperty"]>(
    async (propertyId, patch) => {
      setData((current) => ({
        ...current,
        properties: current.properties.map((p) =>
          p.id === propertyId ? { ...p, ...(patch.name ? { name: patch.name } : {}) } : p,
        ),
      }));
      await guarded(async () => {
        await api.patch(`/api/properties/${propertyId}`, patch);
      });
    },
    [guarded],
  );

  /*
   * Moving a property six rows used to be six clicks and six whole-board
   * refetches, with the page visibly reloading under the hand doing it. The
   * order is ours to work out; the broadcast reconciles it.
   */
  const moveProperty = useCallback<Store["moveProperty"]>(
    async (propertyId, overId) => {
      const landed = landedAfter(data.properties, propertyId, overId);
      if (!landed) return;

      setData((current) => ({ ...current, properties: landed.ordered }));
      await guarded(async () => {
        await api.patch(`/api/properties/${propertyId}`, { afterId: landed.afterId });
      });
    },
    [data.properties, guarded],
  );

  const deleteProperty = useCallback<Store["deleteProperty"]>(
    async (propertyId) => {
      await guarded(async () => {
        await api.del(`/api/properties/${propertyId}`);
        await refresh();
      });
    },
    [guarded, refresh],
  );

  const store: Store = {
    data,
    user,
    view,
    groupProperty,
    filters,
    viewFilters,
    lens,
    visibleTasks,
    setFilters,
    setLens,
    clearLens,
    promoteLens,
    sort,
    viewSort,
    lensSort,
    setSort,
    setViewSort,
    cardItems: items,
    setCardView,
    resetCardView,
    runOf,
    controlRun,
    live,
    toasts,
    setViewId,
    notify,
    refresh,
    wrote,
    presence,
    createTask,
    patchTask,
    deleteTask,
    archiveTask,
    restoreTask,
    undeleteTask,
    archiveColumn,
    moveTask,
    setValue,
    linkBlocker,
    picked: pickedHere,
    isPicked,
    togglePick,
    pickTo,
    clearPicks,
    setPickedValue,
    archivePicked,
    syncTaskCounts,
    createView,
    updateView,
    deleteView,
    setMainView,
    moveView,
    addOption,
    patchOption,
    deleteOption,
    addProperty,
    patchProperty,
    moveProperty,
    moveOption,
    deleteProperty,
  };

  return <BoardContext.Provider value={store}>{children}</BoardContext.Provider>;
}
