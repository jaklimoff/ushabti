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
import { api, ApiError, CLIENT_ID } from "@/lib/client";
import { rankBetween } from "@/lib/rank";
import type {
  BoardData,
  PropertyDTO,
  PropertyType,
  TaskDTO,
  TaskValue,
  ViewDTO,
} from "@/lib/types";
import type { SessionUser } from "@/components/ui/UserMenu";

type Toast = { id: number; text: string; kind: "error" | "info" };

type Store = {
  data: BoardData;
  user: SessionUser;
  view: ViewDTO | null;
  groupProperty: PropertyDTO | null;
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

  createView: (name: string, groupById: string) => Promise<void>;
  updateView: (viewId: string, patch: { name?: string; groupById?: string }) => Promise<void>;
  deleteView: (viewId: string) => Promise<void>;

  addOption: (propertyId: string, name: string) => Promise<string | null>;
  patchOption: (
    optionId: string,
    patch: { name?: string; color?: string; afterId?: string | null },
  ) => Promise<void>;
  deleteOption: (optionId: string) => Promise<void>;
  addProperty: (name: string, type: PropertyType, options?: string[]) => Promise<void>;
  patchProperty: (
    propertyId: string,
    patch: { name?: string; showOnCard?: boolean },
  ) => Promise<void>;
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

  const refresh = useCallback(async () => {
    try {
      const fresh = await api.get<BoardData>(`/api/projects/${projectId}/board`);
      setData(fresh);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) window.location.href = "/projects";
    }
  }, [projectId]);

  /* --- live updates from the other people on the board ---------------- */
  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/stream`);
    let timer: ReturnType<typeof setTimeout> | null = null;

    source.addEventListener("ready", () => setLive(true));
    source.addEventListener("change", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { clientId?: string };
      if (payload.clientId === CLIENT_ID) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
        window.dispatchEvent(new CustomEvent("ushabti:remote-change"));
      }, 140);
    });
    source.onerror = () => setLive(false);
    source.onopen = () => setLive(true);

    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [projectId, refresh]);

  /* --- derived -------------------------------------------------------- */
  const view = useMemo(
    () => data.views.find((v) => v.id === viewId) ?? data.views[0] ?? null,
    [data.views, viewId],
  );

  const groupProperty = useMemo(
    () => (view?.groupById ? (data.properties.find((p) => p.id === view.groupById) ?? null) : null),
    [data.properties, view],
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
      try {
        await work();
      } catch (err) {
        notify(err instanceof Error ? err.message : "The change did not save.");
        await refresh();
      }
    },
    [notify, refresh],
  );

  /* --- tasks ---------------------------------------------------------- */
  const createTask = useCallback<Store["createTask"]>(
    async (input) => {
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
    [notify, projectId],
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
    async (name, groupById) => {
      try {
        const { view: created } = await api.post<{ view: ViewDTO }>(
          `/api/projects/${projectId}/views`,
          { name, groupById },
        );
        setData((current) => ({ ...current, views: [...current.views, created] }));
        setViewId(created.id);
      } catch (err) {
        notify(err instanceof Error ? err.message : "The view did not save.");
      }
    },
    [notify, projectId, setViewId],
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

  /* --- properties and options ----------------------------------------- */
  const addOption = useCallback<Store["addOption"]>(
    async (propertyId, name) => {
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
    [notify],
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
          p.id === propertyId
            ? {
                ...p,
                ...(patch.name ? { name: patch.name } : {}),
                ...(patch.showOnCard !== undefined
                  ? { config: { ...p.config, showOnCard: patch.showOnCard } }
                  : {}),
              }
            : p,
        ),
      }));
      await guarded(async () => {
        await api.patch(`/api/properties/${propertyId}`, patch);
      });
    },
    [guarded],
  );

  const moveProperty = useCallback<Store["moveProperty"]>(
    async (propertyId, afterId) => {
      await guarded(async () => {
        await api.patch(`/api/properties/${propertyId}`, { afterId });
        await refresh();
      });
    },
    [guarded, refresh],
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
