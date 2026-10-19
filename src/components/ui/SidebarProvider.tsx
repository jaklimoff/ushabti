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
import { homeReader, SILENCE_CHECK_MS, type HomeReader } from "@/lib/home-live";
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
  /** The board's own count of the open project, which the sidebar reads for it. */
  own: (projectId: string, waiting: number) => () => void;
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
  const [owned, setOwned] = useState<{ projectId: string; waiting: number } | null>(null);
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

  /* The one stream: the page's, or Home's when the page lent none. */
  useEffect(() => {
    const borrowed = lentNow.current ?? lent;
    let source: EventSource | null = null;
    let heard: (readonly [Ring, () => void])[] = [];
    const hold = (held: EventSource) => {
      source = held;
      ready.current = false;
      heard = RINGS.map((ring) => {
        const on = () => {
          if (ring === "ready") ready.current = true;
          reader.current?.ring();
          for (const listener of listeners.current) listener(ring);
        };
        held.addEventListener(ring, on);
        return [ring, on] as const;
      });
    };
    let wait: ReturnType<typeof setTimeout> | null = null;
    if (borrowed) {
      gaveBack.current = false;
      hold(borrowed);
    } else if (gaveBack.current) {
      wait = setTimeout(() => hold(new EventSource("/api/home/stream")), GIVE_BACK_MS);
    } else hold(new EventSource("/api/home/stream"));
    return () => {
      if (wait) clearTimeout(wait);
      const held = source as EventSource | null;
      if (!held) return;
      for (const [ring, on] of heard) held.removeEventListener(ring, on);
      if (borrowed) gaveBack.current = true;
      else held.close();
    };
  }, [lent]);

  const working = projects.some(isWorking);
  useEffect(() => {
    if (!working) return;
    const look = setInterval(() => reader.current?.ring(), SILENCE_CHECK_MS);
    return () => clearInterval(look);
  }, [working]);

  const toggle = useCallback(() => {
    setFolded((was) => {
      document.cookie = foldCookie(!was);
      return !was;
    });
  }, []);

  const own = useCallback((projectId: string, waiting: number) => {
    setOwned({ projectId, waiting });
    return () => setOwned((was) => (was?.projectId === projectId ? null : was));
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

  /* The open project's count is the board's own, so the sidebar and the
     board's top bar never disagree. */
  const drawn = useMemo(
    () =>
      owned
        ? projects.map((p) => (p.id === owned.projectId ? { ...p, waiting: owned.waiting } : p))
        : projects,
    [projects, owned],
  );

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
    const source = new EventSource("/api/home/stream");
    for (const ring of RINGS) source.addEventListener(ring, () => latest.current(ring));
    return () => source.close();
  }, [hear]);
}

/** The board's own count of the open project, handed to the sidebar. */
export function useOwnWaiting(projectId: string, waiting: number) {
  const own = useSidebar()?.own;
  useEffect(() => own?.(projectId, waiting), [own, projectId, waiting]);
}
