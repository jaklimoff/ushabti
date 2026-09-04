"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, CLIENT_ID } from "@/lib/client";
import { cardItems, defaultCardView, readCardView } from "@/lib/card-view";
import type { CardItem } from "@/lib/card-view";
import { applyFilters, EMPTY_FILTERS } from "@/lib/filters";
import { rankBetween } from "@/lib/rank";
import type {
  AgentRunDTO,
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

type Toast = { id: number; text: string; kind: "error" | "info" };

type Store = {
  data: BoardData;
  user: SessionUser;
  view: ViewDTO | null;
  groupProperty: PropertyDTO | null;
  /** The rules of the view on screen. */
  filters: ViewFilters;
  /**
   * The tasks that view shows. Everything that counts tasks reads this, so the
   * columns, the count in the strip and the empty state can never disagree.
   */
  visibleTasks: TaskDTO[];
  /** Writes the rules of the view. They save at once, like the grouping does. */
  setFilters: (rules: FilterRule[]) => Promise<void>;
  /** The order the view draws its rows in, or null for the shared rank. */
  sort: ViewSort | null;
  /** Writes that order. It saves at once, exactly as a rule does. */
  setSort: (sort: ViewSort | null) => Promise<void>;
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
  notify: (text: string, kind?: Toast["kind"]) => void;
  refresh: () => Promise<void>;

  createTask: (input: {
    title: string;
    values?: Record<string, TaskValue>;
    afterId?: string | null;
    atTop?: boolean;
  }) => Promise<TaskDTO | null>;
  patchTask: (taskId: string, patch: { title?: string; description?: string }) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  moveTask: (input: {
    taskId: string;
    beforeId: string | null;
    afterId: string | null;
    values?: Record<string, TaskValue>;
  }) => Promise<void>;
  setValue: (taskId: string, propertyId: string, value: TaskValue) => Promise<void>;
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
   * Puts one view where another one sits. A drag names the view it landed on,
   * not a rank: the strip and the settings page then say the same thing in the
   * same words, and only this one place works the neighbours out.
   */
  moveView: (viewId: string, overId: string) => Promise<void>;

  addOption: (propertyId: string, name: string) => Promise<string | null>;
  patchOption: (
    optionId: string,
    patch: { name?: string; color?: string; afterId?: string | null },
  ) => Promise<void>;
  deleteOption: (optionId: string) => Promise<void>;
  addProperty: (name: string, type: PropertyType, options?: string[]) => Promise<void>;
  patchProperty: (propertyId: string, patch: { name?: string }) => Promise<void>;
  moveProperty: (propertyId: string, afterId: string | null) => Promise<void>;
  deleteProperty: (propertyId: string) => Promise<void>;
};

const BoardContext = createContext<Store | null>(null);

export function useBoard(): Store {
  const store = useContext(BoardContext);
  if (!store) throw new Error("useBoard must run inside BoardProvider.");
  return store;
}

const VIEW_KEY = "ushabti:view:";

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
  const [viewId, setViewIdState] = useState<string>(
    initial.views.find((v) => v.isDefault)?.id ?? initial.views[0]?.id ?? "",
  );
  const [live, setLive] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const router = useRouter();
  const projectId = data.project.id;

  /* --- restore the last view of this project -------------------------- */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY + projectId);
      if (saved) setViewIdState((current) => (saved === current ? current : saved));
    } catch {
      /* private mode */
    }
  }, [projectId]);

  const setViewId = useCallback(
    (id: string) => {
      setViewIdState(id);
      try {
        window.localStorage.setItem(VIEW_KEY + projectId, id);
      } catch {
        /* private mode */
      }
    },
    [projectId],
  );

  const notify = useCallback((text: string, kind: Toast["kind"] = "error") => {
    const id = (toastSeq.current += 1);
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 5200);
  }, []);

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

  /* --- live updates from the other people on the board ---------------- */
  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/stream`);
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
    source.onerror = () => setLive(false);
    source.onopen = opened;

    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [projectId]);

  /* --- derived -------------------------------------------------------- */
  const view = useMemo(
    () => data.views.find((v) => v.id === viewId) ?? data.views[0] ?? null,
    [data.views, viewId],
  );

  const groupProperty = useMemo(
    () => (view?.groupById ? (data.properties.find((p) => p.id === view.groupById) ?? null) : null),
    [data.properties, view],
  );

  const filters = view?.filters ?? EMPTY_FILTERS;
  const sort = view?.sort ?? null;

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

  const visibleTasks = useMemo(
    () => applyFilters(data.tasks, filters, data.properties),
    [data.properties, data.tasks, filters],
  );

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
  const patchLocalTask = useCallback((taskId: string, patch: Partial<TaskDTO>) => {
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    }));
  }, []);

  const guarded = useCallback(
    async (work: () => Promise<void>) => {
      wrote();
      try {
        await work();
      } catch (err) {
        notify(err instanceof Error ? err.message : "The change did not save.");
        await refresh();
      }
    },
    [notify, refresh, wrote],
  );

  /* --- tasks ---------------------------------------------------------- */
  const createTask = useCallback<Store["createTask"]>(
    async (input) => {
      wrote();
      try {
        const { task } = await api.post<{ task: TaskDTO & { key: string } }>(
          `/api/projects/${projectId}/tasks`,
          {
            title: input.title,
            values: input.values ?? {},
            afterId: input.afterId ?? null,
            atTop: input.atTop ?? false,
          },
        );
        const complete: TaskDTO = {
          ...task,
          values: input.values ?? {},
          checklistTotal: 0,
          checklistDone: 0,
          commentCount: 0,
          description: task.description ?? "",
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

  const deleteTask = useCallback<Store["deleteTask"]>(
    async (taskId) => {
      setData((current) => ({ ...current, tasks: current.tasks.filter((t) => t.id !== taskId) }));
      await guarded(async () => {
        await api.del(`/api/tasks/${taskId}`);
      });
    },
    [guarded],
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
    },
    [guarded, patchLocalTask],
  );

  const setValue = useCallback<Store["setValue"]>(
    async (taskId, propertyId, value) => {
      setData((current) => ({
        ...current,
        tasks: current.tasks.map((t) =>
          t.id === taskId ? { ...t, values: { ...t.values, [propertyId]: value } } : t,
        ),
      }));
      await guarded(async () => {
        await api.put(`/api/tasks/${taskId}/values/${propertyId}`, { value });
      });
    },
    [guarded],
  );

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

  const setSort = useCallback<Store["setSort"]>(
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
      cardView: defaultCardView(
        current.properties,
        (current.views.find((v) => v.isDefault) ?? current.views[0])?.groupById ?? null,
      ),
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

  /*
   * The order of the views is the order of the strip, so the answer is worked
   * out here and drawn at once. The board is fetched again only if the write
   * fails.
   */
  const moveView = useCallback<Store["moveView"]>(
    async (id, overId) => {
      const list = data.views;
      const from = list.findIndex((v) => v.id === id);
      const to = list.findIndex((v) => v.id === overId);
      if (from < 0 || to < 0 || from === to) return;

      const ordered = list.filter((v) => v.id !== id);
      ordered.splice(to, 0, list[from]);
      // The view it now sits behind. Null is the front of the strip.
      const afterId = ordered[to - 1]?.id ?? null;

      setData((current) => ({ ...current, views: ordered }));
      await guarded(async () => {
        await api.patch(`/api/views/${id}`, { afterId });
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
    async (propertyId, afterId) => {
      setData((current) => {
        const list = current.properties;
        const moving = list.find((p) => p.id === propertyId);
        if (!moving) return current;
        const rest = list.filter((p) => p.id !== propertyId);
        const at = afterId === null ? 0 : rest.findIndex((p) => p.id === afterId) + 1;
        if (afterId !== null && at === 0) return current;
        return { ...current, properties: [...rest.slice(0, at), moving, ...rest.slice(at)] };
      });
      await guarded(async () => {
        await api.patch(`/api/properties/${propertyId}`, { afterId });
      });
    },
    [guarded],
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
    visibleTasks,
    setFilters,
    sort,
    setSort,
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
    createTask,
    patchTask,
    deleteTask,
    moveTask,
    setValue,
    syncTaskCounts,
    createView,
    updateView,
    deleteView,
    moveView,
    addOption,
    patchOption,
    deleteOption,
    addProperty,
    patchProperty,
    moveProperty,
    deleteProperty,
  };

  return <BoardContext.Provider value={store}>{children}</BoardContext.Provider>;
}
