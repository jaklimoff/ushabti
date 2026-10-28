"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { isTyping } from "@/components/board/keys";
import { PROJECT_INK } from "@/lib/colors";
import { isPhone, notPhone, subscribePhone } from "@/lib/phone";
import type { ProjectNow } from "@/lib/queries";
import { isWorking, lineOf, type Line } from "@/lib/sidebar";
import { BrandMark } from "./Marks";
import { useSidebar } from "./SidebarProvider";
import { useDismiss } from "./useDismiss";
import { useNow } from "./useElapsed";
import styles from "./Sidebar.module.css";

/** What a square or a row says of its project, for a tip and a screen reader. */
function said(project: ProjectNow, line: Line): string {
  return `${project.name}: ${line.text}`;
}

/**
 * A project's colour and the start of its key, as the card and the board's
 * bar show it: one letter made USH and USHA, or MOB and MKT, the same square.
 * The rail has nothing beside a square, so it takes four letters; the open
 * sidebar names the project beside it, so three fit its smaller square. The
 * rail has no words either, so the dot and the count sit on the square there;
 * the open sidebar says them at the row's end instead, off the letters.
 */
function Square({
  project,
  big,
  current,
}: {
  project: ProjectNow;
  big?: boolean;
  current?: boolean;
}) {
  return (
    <span
      className={`${styles.square} ${big ? styles.squareBig : ""}`}
      data-current={current || undefined}
      data-testid="sidebar-square"
      style={{ background: project.color, color: PROJECT_INK }}
      aria-hidden
    >
      {project.key.slice(0, big ? 4 : 3)}
      {big && isWorking(project) && <span className={styles.dot} data-testid="sidebar-dot" />}
      {big && project.waiting > 0 && (
        <span className={styles.count} data-testid="sidebar-count">
          {project.waiting}
        </span>
      )}
    </span>
  );
}

/** What the open sidebar says at a row's end: the dot of an agent at work, then what waits. */
function RowEnd({ project }: { project: ProjectNow }) {
  const working = isWorking(project);
  if (!working && project.waiting === 0) return null;
  return (
    <span className={styles.rowEnd} aria-hidden>
      {working && <span className={styles.rowDot} data-testid="sidebar-dot" />}
      {project.waiting > 0 && (
        <span className={styles.rowCount} data-testid="sidebar-count">
          {project.waiting}
        </span>
      )}
    </span>
  );
}

/** A house, for the one row that is Home. */
function HomeGlyph() {
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinejoin="round"
    >
      <path d="M2 6.2 7 2l5 4.2V12H8.6V8.6H5.4V12H2z" />
    </svg>
  );
}

/** Whether this page is Home, which the sidebar marks as it marks the open project. */
function useOnHome(): boolean {
  return usePathname() === "/projects";
}

/** The `[` key folds and unfolds, as a key and not a letter, on every layout. */
function useFoldKey(toggle: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.code !== "BracketLeft" || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || isPhone()) return;
      /* A lifted card owns the keys until it is put down. */
      if (document.body.classList.contains("ushabti-dragging")) return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, active]);
}

/* A tip of our own, as the Listening faces have: a title waits, never shows
   on focus and is read twice. It is fixed, so a rail that scrolls cannot cut
   it off. */
function placeTip(host: HTMLElement) {
  const tip = host.querySelector<HTMLElement>("[data-testid='sidebar-tip']");
  if (!tip) return;
  const box = host.getBoundingClientRect();
  tip.style.left = `${box.right + 10}px`;
  tip.style.top = `${box.top + box.height / 2}px`;
}

function FoldIcon({ folded }: { folded: boolean }) {
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
    >
      <rect x="1.5" y="2" width="11" height="10" rx="2" />
      <path d="M5 2v10" />
      <path
        d={folded ? "M7.8 5.5L9.3 7 7.8 8.5" : "M9.3 5.5L7.8 7l1.5 1.5"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Every project of the person down the left of every signed-in page, and the
 * one way to switch. Folded it is a rail of squares; open it names each one
 * and says what is going on there. It is drawn only once there is somewhere
 * else to go, and a phone has it as a sheet from the project mark instead.
 */
export function Sidebar() {
  const sidebar = useSidebar();
  const shown = sidebar?.shown ?? false;
  const toggle = sidebar?.toggle;
  const noop = useCallback(() => {}, []);
  useFoldKey(toggle ?? noop, shown && !!toggle);
  if (!sidebar || !shown) return null;
  return sidebar.folded ? <Rail /> : <Open />;
}

function Rail() {
  const { projects, current, toggle } = useSidebar()!;
  const home = useOnHome();
  const working = projects.some(isWorking);
  const now = useNow(working);
  /* One Tab stop: the arrows walk the rail, and Tab leaves it. */
  const items = ["_home", ...projects.map((p) => p.id), "_new", "_fold"];
  const [at, setAt] = useState<string | null>(null);
  const stop =
    at && items.includes(at) ? at : current && items.includes(current) ? current : "_home";
  const rail = useRef<HTMLElement>(null);

  function walk(e: React.KeyboardEvent) {
    const index = items.indexOf(stop);
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight")
      next = Math.min(items.length - 1, index + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setAt(items[next]);
    rail.current?.querySelector<HTMLElement>(`[data-item="${items[next]}"]`)?.focus();
  }

  const tab = (id: string) => (id === stop ? 0 : -1);

  return (
    <nav
      ref={rail}
      className={`${styles.sidebar} ${styles.rail}`}
      aria-label="Projects"
      data-testid="sidebar"
      data-folded="true"
      onKeyDown={walk}
      onFocus={(e) => {
        const id = (e.target as HTMLElement).dataset.item;
        if (id) setAt(id);
      }}
    >
      <div className={styles.head}>
        <Link
          href="/projects"
          className={styles.railItem}
          data-item="_home"
          tabIndex={tab("_home")}
          aria-label="Home"
          aria-current={home ? "page" : undefined}
          title="Home"
        >
          <span className={styles.railBrand} data-current={home || undefined}>
            <BrandMark size={22} />
          </span>
        </Link>
      </div>
      <div className={styles.railList}>
        {projects.map((project) => {
          const line = lineOf(project, now);
          const here = project.id === current;
          return (
            <Link
              key={project.id}
              href={`/p/${project.id}`}
              className={styles.railItem}
              data-item={project.id}
              data-testid="sidebar-project"
              tabIndex={tab(project.id)}
              aria-label={said(project, line)}
              aria-current={here ? "page" : undefined}
              onPointerEnter={(e) => placeTip(e.currentTarget)}
              onFocus={(e) => placeTip(e.currentTarget)}
            >
              <Square project={project} big current={here} />
              <span className={styles.tip} data-testid="sidebar-tip" aria-hidden="true">
                <span className={styles.tipName}>{project.name}</span>
                <span className={styles.line} data-kind={line.kind}>
                  {line.text}
                </span>
              </span>
            </Link>
          );
        })}
        <Link
          href="/projects?new"
          className={`${styles.railItem} ${styles.railNew}`}
          data-item="_new"
          tabIndex={tab("_new")}
          aria-label="New project"
          title="New project"
        >
          +
        </Link>
      </div>
      <button
        type="button"
        className={`${styles.railItem} ${styles.fold}`}
        data-item="_fold"
        tabIndex={tab("_fold")}
        onClick={toggle}
        aria-label="Open the sidebar"
        aria-expanded={false}
        title="Open the sidebar  ["
        data-testid="sidebar-fold"
      >
        <FoldIcon folded />
      </button>
    </nav>
  );
}

/** The rows the open sidebar and the phone's sheet both draw. */
function Rows({ onPick, menu }: { onPick?: () => void; menu?: boolean }) {
  const { projects, lists, current } = useSidebar()!;
  const working = projects.some(isWorking);
  const now = useNow(working);
  const role = menu ? "menuitem" : undefined;
  return (
    <>
      <div className={styles.section} role={menu ? "presentation" : undefined}>
        Projects
      </div>
      {projects.map((project) => {
        const line = lineOf(project, now);
        const here = project.id === current;
        return (
          <Link
            key={project.id}
            href={`/p/${project.id}`}
            className={styles.row}
            role={role}
            tabIndex={menu ? -1 : undefined}
            data-testid="sidebar-row"
            aria-current={here ? "page" : undefined}
            aria-label={said(project, line)}
            onClick={onPick}
          >
            <Square project={project} current={here} />
            <span className={styles.rowWords}>
              <span className={styles.rowName}>{project.name}</span>
              <span
                className={styles.line}
                data-kind={line.kind}
                data-testid="sidebar-line"
                suppressHydrationWarning
              >
                {line.text}
              </span>
            </span>
            <RowEnd project={project} />
          </Link>
        );
      })}
      {lists.length > 0 && (
        <>
          <div className={styles.section} role={menu ? "presentation" : undefined}>
            Lists
          </div>
          {lists.map((list) => (
            <Link
              key={list.id}
              href={`/lists/${list.id}`}
              className={`${styles.row} ${styles.listRow}`}
              role={role}
              tabIndex={menu ? -1 : undefined}
              data-testid="sidebar-list"
              onClick={onPick}
            >
              <span className={styles.glyph} aria-hidden>
                ≡
              </span>
              <span className={styles.rowName}>{list.name}</span>
            </Link>
          ))}
        </>
      )}
    </>
  );
}

function Open() {
  const { toggle } = useSidebar()!;
  const home = useOnHome();
  return (
    <nav
      className={`${styles.sidebar} ${styles.open}`}
      aria-label="Projects"
      data-testid="sidebar"
      data-folded="false"
    >
      <div className={styles.head}>
        {/* The brand, once: it leads Home, and the Home row below says where you are. */}
        <Link href="/projects" className={styles.brand} title="Home">
          <BrandMark />
          <span>Ushabti</span>
        </Link>
        <button
          type="button"
          className={styles.fold}
          onClick={toggle}
          aria-label="Fold the sidebar"
          aria-expanded
          title="Fold the sidebar  ["
          data-testid="sidebar-fold"
        >
          <FoldIcon folded={false} />
        </button>
      </div>
      <div className={styles.openList}>
        <Link
          href="/projects"
          className={`${styles.row} ${styles.listRow}`}
          aria-current={home ? "page" : undefined}
          data-testid="sidebar-home"
        >
          <span className={styles.glyph} aria-hidden>
            <HomeGlyph />
          </span>
          <span className={styles.rowName}>Home</span>
        </Link>
        <Rows />
      </div>
      <Link href="/projects?new" className={`${styles.row} ${styles.newRow}`}>
        <span className={styles.glyph} aria-hidden>
          +
        </span>
        <span className={styles.rowName}>New project</span>
      </Link>
    </nav>
  );
}

/**
 * The project mark at the top of a project page. On a phone the sidebar is
 * not in the page, so the mark opens it as a sheet: a menu, as the switcher
 * was, because the board has no dialogs. Wider, it is a plain mark.
 */
export function SidebarMark({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const phone = useSyncExternalStore(subscribePhone, isPhone, notPhone);
  const sidebar = useSidebar();
  if (!phone || !sidebar)
    return <span className={`${styles.markWrap} ${className ?? ""}`}>{children}</span>;
  return <Sheet className={className}>{children}</Sheet>;
}

function Sheet({ children, className }: { children: React.ReactNode; className?: string }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    const inside = trigger.current?.parentElement?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (inside) trigger.current?.focus();
  }, []);
  const wrap = useDismiss<HTMLDivElement>(close, open);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);

  function walk(e: React.KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = Math.min(items.length - 1, index + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next]?.focus();
  }

  return (
    <div
      ref={wrap}
      className={`${styles.markWrap} ${className ?? ""}`}
      onBlur={(e) => {
        if (open && !wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.markButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Projects"
        data-testid="sidebar-sheet-open"
        onClick={() => setOpen((was) => !was)}
      >
        {children}
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Projects"
          className={styles.sheet}
          data-testid="sidebar-sheet"
          onKeyDown={walk}
        >
          <Link
            href="/projects"
            role="menuitem"
            tabIndex={-1}
            className={`${styles.row} ${styles.listRow}`}
            onClick={() => setOpen(false)}
          >
            <span className={styles.glyph} aria-hidden>
              <HomeGlyph />
            </span>
            <span className={styles.rowName}>Home</span>
          </Link>
          <Rows menu onPick={() => setOpen(false)} />
          <Link
            href="/projects?new"
            role="menuitem"
            tabIndex={-1}
            className={`${styles.row} ${styles.newRow}`}
            onClick={() => setOpen(false)}
          >
            <span className={styles.glyph} aria-hidden>
              +
            </span>
            <span className={styles.rowName}>New project</span>
          </Link>
        </div>
      )}
    </div>
  );
}
