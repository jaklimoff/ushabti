"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { api } from "@/lib/client";
import { walkKeys } from "@/components/board/Ask";
import { useDismiss } from "./useDismiss";
import styles from "./ProjectSwitcher.module.css";

type Project = { id: string; key: string; name: string };

type Row = { key: string; label: string; href: string; current?: boolean; project?: boolean };

/** Past this many projects the list is long enough to want a box. */
const MANY = 8;

/**
 * The project name at the top of a project page, and the one way to another
 * project.
 *
 * It is a menu and not a dialog: the board has none. The list is the one the
 * Projects page reads, asked for each time the menu opens, so a project made
 * in another tab is there without a reload. The bar hands in what the button
 * shows, because the board and the settings bar draw the mark and the name at
 * their own sizes and hide them at their own widths.
 */
export function ProjectSwitcher({ project, children }: { project: Project; children: ReactNode }) {
  const router = useRouter();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([project]);
  const [query, setQuery] = useState("");
  const [atKey, setAtKey] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  /* Each opening asks once. An answer to an older opening is dropped, so a
     slow reply cannot put back a list the person has already moved past. */
  const asked = useRef(0);

  const close = useCallback(() => {
    // The trigger's parent is the whole switcher: the button and the menu.
    const inside = trigger.current?.parentElement?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (inside) trigger.current?.focus();
  }, []);
  const wrap = useDismiss<HTMLDivElement>(close, open);

  function show() {
    setQuery("");
    setAtKey(null);
    setOpen(true);
    const ask = ++asked.current;
    api
      .get<{ projects: Project[] }>("/api/projects")
      .then(({ projects: rows }) => {
        if (ask === asked.current) setProjects(rows);
      })
      .catch(() => {
        /* The menu still holds this project and the two ways out. */
      });
  }

  const many = projects.length > MANY;
  const words = query.trim().toLowerCase();
  const shown = words
    ? projects.filter(
        (p) => p.name.toLowerCase().includes(words) || p.key.toLowerCase().includes(words),
      )
    : projects;

  const rows: Row[] = [
    ...shown.map((p) => ({
      key: p.id,
      label: p.name,
      href: `/p/${p.id}`,
      current: p.id === project.id,
      project: true,
    })),
    { key: "_new", label: "New project", href: "/projects?new" },
    { key: "_all", label: "All projects", href: "/projects" },
  ];

  /* The highlight follows a row and not a place, so the list arriving or
     narrowing under it cannot move it onto another project. */
  const found = rows.findIndex((r) => r.key === atKey);
  const at =
    found >= 0
      ? found
      : words
        ? 0
        : Math.max(
            0,
            rows.findIndex((r) => r.current),
          );
  const setAt: Dispatch<SetStateAction<number>> = (next) => {
    const index = typeof next === "function" ? next(at) : next;
    setAtKey(rows[index]?.key ?? null);
  };

  function pick(row: Row) {
    if (row.current) return close();
    setOpen(false);
    router.push(row.href);
  }

  const keys = walkKeys(rows.length, at, setAt, (i) => pick(rows[i]));

  useEffect(() => {
    if (open && !many) menu.current?.focus();
  }, [open, many]);

  /* A long list scrolls, and the highlight must stay in sight. */
  useEffect(() => {
    if (open) document.getElementById(`${menuId}-${at}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, at, menuId]);

  return (
    <div
      className={styles.wrap}
      ref={wrap}
      onBlur={(e) => {
        // Tab out of the menu closes it, as a press outside does.
        if (open && !wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={project.name}
        title="Switch project"
        data-testid="project-switcher"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            show();
          }
        }}
      >
        {children}
        <span className={styles.caret} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className={styles.panel}>
          {many && (
            <input
              className={styles.box}
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={menuId}
              aria-activedescendant={`${menuId}-${at}`}
              aria-label="Find a project"
              data-testid="project-switcher-find"
              placeholder="Find a project…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setAtKey(null);
              }}
              onKeyDown={keys}
            />
          )}
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label="Projects"
            tabIndex={-1}
            className={styles.menu}
            aria-activedescendant={many ? undefined : `${menuId}-${at}`}
            onKeyDown={many ? undefined : keys}
          >
            {shown.length === 0 && <span className={styles.note}>No project matches.</span>}
            {rows.map((row, i) => (
              <Link
                key={row.key}
                id={`${menuId}-${i}`}
                href={row.href}
                role={row.project ? "menuitemradio" : "menuitem"}
                aria-checked={row.project ? !!row.current : undefined}
                tabIndex={-1}
                className={`${styles.item} ${i === at ? styles.itemAt : ""} ${
                  row.key === "_new" ? styles.itemRule : ""
                }`}
                // The menu keeps the focus, so the press must not move it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  if (row.current) {
                    e.preventDefault();
                    close();
                  } else setOpen(false);
                }}
              >
                <span className={styles.label}>{row.label}</span>
                {row.project && (
                  <span className={styles.tick} aria-hidden>
                    {row.current ? "✓" : ""}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
