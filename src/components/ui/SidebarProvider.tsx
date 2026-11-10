"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/client";
import { keepOpen } from "@/lib/reopen";
import { homeReader, SILENCE_CHECK_MS, type HomeReader } from "@/lib/home-live";
import { agentsNamed } from "@/lib/pulse";
import type { ProjectNow } from "@/lib/queries";
import {
  foldCookie,
  isWorking,
  projectOfPath,
  sidebarShown,
  type SidebarList,
} from "@/lib/sidebar";

/** The events a page's stream rings that the sidebar and Home answer. */
const RINGS = ["ready", "change", "elsewhere"] as const;
type Ring = (typeof RINGS)[number];
type Hear = (ring: Ring) => void;

/** How long a stream given back waits for the next page to lend one. */
const GIVE_BACK_MS = 1500;

/** Home's drag says so, because a person's own order broadcasts nothing. */
export const PROJECTS_MOVED = "ushabti:projects-moved";

type Sidebar = {
  projects: ProjectNow[];
  lists: SidebarList[];
  /** The project of the page, or null off a project page. */
  current: string | null;
  shown: boolean;
  folded: boolean;
  toggle: () => void;
  /**
   * What the board knows of the open project, which the sidebar reads for it:
   * the count, and the open runs its dot and agents are worked out from.
   */
  own: (projectId: string, waiting: number, runs: OwnRun[]) => () => void;
  /** A page that already holds a stream lends it, so a tab holds one. */
  lend: (source: EventSource) => () => void;
  hear: (listener: Hear) => () => void;
};

const SidebarContext = createContext<Sidebar | null>(null);

export function useSidebar(): Sidebar | null {
  return useContext(SidebarContext);
}

/**
 * What the sidebar draws, and the one stream a tab holds.
 *
 * It sits in the layout every signed-in page shares, and Next does not draw a
 * layout again on navigation, so the stream and the fold outlive the page. A
 * board lends its own stream: `elsewhere` rings for the other projects and
 * the board's own events for this one. Off a board the sidebar holds
 * `/api/home/stream`, and Home listens to that one rather than opening its
 * own.
 *
 * A ring is a doorbell, as everywhere: the sidebar reads
 * `/api/home/projects` again, gathered by `homeReader`. Of two reads only the
 * newer lands. Going silent rings nothing, so while an agent is at work it
 * also looks on its own.
 */
export function SidebarProvider({
  projects: given,
  lists: givenLists,
  folded: givenFolded,
  children,
}: {
  projects: ProjectNow[];
  lists: SidebarList[];
  folded: boolean;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const current = projectOfPath(path);
  const [projects, setProjects] = useState(given);
  const [lists, setLists] = useState(givenLists);
  const [folded, setFolded] = useState(givenFolded);
  const [owned, setOwned] = useState<{
    projectId: string;
    waiting: number;
    runs: OwnRun[];
    /* When the runs were last weighed: an agent falls silent as time passes. */
    now: number;
  } | null>(null);
  /* Which project a board counts right now, for the stream's rings. */
  const counted = useRef<string | null>(null);
  const [lent, setLent] = useState<EventSource | null>(null);
  /* A board lends its stream in its own effect, which runs before this
     one: the ref says so at once, so the first paint opens no second
     stream that the next render would close. */
  const lentNow = useRef<EventSource | null>(null);
  const listeners = useRef(new Set<Hear>());
  /* Whether the stream held now has said `ready`. A page that streams in
     after it did is told at once, or it would never read on connect. */
  const ready = useRef(false);
  /* Whether a page lent a stream and gave it back: between two boards the
     loading frame stands in for a moment, and that is no time to open
     Home's stream only to close it again. */
  const gaveBack = useRef(false);
  const asked = useRef(0);
  const reader = useRef<HomeReader | null>(null);

  /* A refresh of the layout hands down a fresh answer, which is newer than
     any read still out. */
  const [was, setWas] = useState({ given, givenLists });
  if (was.given !== given || was.givenLists !== givenLists) {
    setWas({ given, givenLists });
    asked.current += 1;
    setProjects(given);
    setLists(givenLists);
  }

  const read = useCallback((withLists: boolean) => {
    const ask = ++asked.current;
    void api
      .get<{ projects: ProjectNow[] }>("/api/home/projects")
      .then(({ projects: rows }) => {
        if (ask === asked.current && Array.isArray(rows)) setProjects(rows);
      })
      .catch(() => {
        /* The next ring reads again. */
      });
    if (withLists)
      void api
        .get<{ lists?: SidebarList[] }>("/api/lists")
        .then(({ lists: rows }) => {
          if (ask === asked.current && Array.isArray(rows)) setLists(rows);
        })
        .catch(() => {});
  }, []);

  useEffect(() => {
    const live = homeReader({
      read: () => read(false),
      hidden: () => document.visibilityState === "hidden",
    });
    reader.current = live;
    const shown = () => live.shown();
    const moved = () => read(false);
    document.addEventListener("visibilitychange", shown);
    window.addEventListener(PROJECTS_MOVED, moved);
    return () => {
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener(PROJECTS_MOVED, moved);
      live.stop();
      reader.current = null;
    };
  }, [read]);

  /* A project or a list is made, joined or left by moving to another page,
     so each page asks once, lists and all. The first one was drawn with it. */
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    read(true);
  }, [path, read]);

  /* The one stream: the page's, or Home's when the page lent none. A page
     opens its own again when it closes for good, and lends the new one;
     Home's is opened again here. */
  useEffect(() => {
    const borrowed = lentNow.current ?? lent;
    /* A board's own rings are its own: its count comes from the board, so
       the sidebar reads the projects only when another one rings. A page
       that lends a stream and counts nothing, settings, still rings it. */
    const hold = (held: EventSource, board: boolean) => {
      ready.current = false;
      const heard = RINGS.map((ring) => {
        const on = () => {
          if (ring === "ready") ready.current = true;
          if (!board || ring !== "change" || !counted.current) reader.current?.ring();
          for (const listener of listeners.current) listener(ring);
        };
        held.addEventListener(ring, on);
        return [ring, on] as const;
      });
      return () => {
        for (const [ring, on] of heard) held.removeEventListener(ring, on);
      };
    };
    const home = () =>
      keepOpen(
        () => new EventSource("/api/home/stream"),
        (held) => {
          const unhear = hold(held, false);
          return () => {
            unhear();
            held.close();
          };
        },
      );
    if (borrowed) {
      gaveBack.current = false;
      const unhear = hold(borrowed, true);
      return () => {
        unhear();
        gaveBack.current = true;
      };
    }
    let stop: (() => void) | null = null;
    let wait: ReturnType<typeof setTimeout> | null = null;
    if (gaveBack.current) wait = setTimeout(() => (stop = home()), GIVE_BACK_MS);
    else stop = home();
    return () => {
      if (wait) clearTimeout(wait);
      (stop as (() => void) | null)?.();
    };
  }, [lent]);

  const toggle = useCallback(() => {
    setFolded((was) => {
      document.cookie = foldCookie(!was);
      return !was;
    });
  }, []);

  const own = useCallback((projectId: string, waiting: number, runs: OwnRun[]) => {
    counted.current = projectId;
    setOwned({ projectId, waiting, runs, now: Date.now() });
    return () => {
      if (counted.current === projectId) counted.current = null;
      setOwned((was) => (was?.projectId === projectId ? null : was));
    };
  }, []);

  const lend = useCallback((source: EventSource) => {
    lentNow.current = source;
    setLent(source);
    return () => {
      if (lentNow.current === source) lentNow.current = null;
      setLent((was) => (was === source ? null : was));
    };
  }, []);

  const hear = useCallback((listener: Hear) => {
    listeners.current.add(listener);
    if (ready.current) queueMicrotask(() => listeners.current.has(listener) && listener("ready"));
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  /* The open project's count and agents are the board's own, so the sidebar
     and the board never disagree, and a ring of the board needs no read of
     every project to light the dot. */
  const drawn = useMemo(
    () =>
      owned
        ? projects.map((p) =>
            p.id === owned.projectId
              ? { ...p, waiting: owned.waiting, agents: agentsNamed(owned.runs, owned.now) }
              : p,
          )
        : projects,
    [projects, owned],
  );

  const working = drawn.some(isWorking);

  useEffect(() => {
    if (!working) return;
    const look = setInterval(() => {
      reader.current?.ring();
      setOwned((was) => (was ? { ...was, now: Date.now() } : was));
    }, SILENCE_CHECK_MS);
    return () => clearInterval(look);
  }, [working]);

  const value = useMemo<Sidebar>(
    () => ({
      projects: drawn,
      lists,
      current,
      shown: sidebarShown(drawn, lists),
      folded,
      toggle,
      own,
      lend,
      hear,
    }),
    [drawn, lists, current, folded, toggle, own, lend, hear],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

/**
 * Lends a page's stream to the sidebar while the page holds it. A page drawn
 * without the sidebar, as in a component test, lends nothing.
 */
export function useLendStream(): Sidebar["lend"] | null {
  return useSidebar()?.lend ?? null;
}

/**
 * Hears the tab's one stream. Without a sidebar around it, as in a component
 * test or a page drawn alone, it holds Home's stream itself.
 */
export function useTabRings(listener: Hear) {
  const sidebar = useSidebar();
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  const hear = sidebar?.hear;
  useEffect(() => {
    if (hear) return hear((ring) => latest.current(ring));
    return keepOpen(
      () => new EventSource("/api/home/stream"),
      (source) => {
        for (const ring of RINGS) source.addEventListener(ring, () => latest.current(ring));
        return () => source.close();
      },
    );
  }, [hear]);
}

/** An open run as the sidebar names its agent: with the key of its task. */
export type OwnRun = Parameters<typeof agentsNamed>[0][number];

/** The board's own count and runs of the open project, handed to the sidebar. */
export function useOwnProject(projectId: string, waiting: number, runs: OwnRun[]) {
  const own = useSidebar()?.own;
  useEffect(() => own?.(projectId, waiting, runs), [own, projectId, waiting, runs]);
}
