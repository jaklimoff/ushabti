"use client";

import { Fragment } from "react";
import Link from "next/link";
import { BrandMark } from "./Marks";
import { useSidebar } from "./SidebarProvider";
import { UserMenu, type SessionUser } from "./UserMenu";
import styles from "./ui.module.css";

/**
 * The one bar at the top of every page off the board. There used to be five,
 * at two paddings and two gaps, so the mark moved between pages and only some
 * of them led home. Here the Ushabti mark links Home, the trail says where
 * you are, and the actions are quiet words at the end.
 *
 * `home={false}` drops the mark, and the trail then opens with no slash. A
 * project page drops it while the sidebar leads Home: the project's own mark
 * and name are the ones that matter there. `word` keeps the name Ushabti
 * beside the mark.
 */
export function AppBar({
  user,
  trail = [],
  actions,
  home = true,
  word = true,
  homeTestId,
}: {
  user: SessionUser;
  /** What comes after the mark, left to right. The last is where you are. */
  trail?: React.ReactNode[];
  actions?: React.ReactNode;
  home?: boolean;
  word?: boolean;
  homeTestId?: string;
}) {
  return (
    <header className={styles.appBar}>
      <nav className={styles.appTrail} aria-label="Where you are">
        {home && <AppHome word={word} testId={homeTestId} />}
        {trail.map((item, i) => (
          <Fragment key={i}>
            {(home || i > 0) && <AppSep />}
            {item}
          </Fragment>
        ))}
      </nav>
      <span className={styles.spacer} />
      {actions && <div className={styles.appActions}>{actions}</div>}
      <UserMenu user={user} />
    </header>
  );
}

/**
 * Whether a project page's bar leads Home. The sidebar does, both folded and
 * open, so the bar leaves it out; with one project and no list there is no
 * sidebar, and then the mark is the only way back.
 */
export function useHomeInBar(): boolean {
  const sidebar = useSidebar();
  return sidebar !== null && !sidebar.shown;
}

/** Ushabti's mark, the way Home. */
export function AppHome({ word = true, testId }: { word?: boolean; testId?: string }) {
  return (
    <Link
      href="/projects"
      className={styles.appHome}
      title="Home"
      aria-label={word ? undefined : "Home"}
      data-testid={testId}
    >
      <BrandMark />
      {word && <span className={styles.appBrand}>Ushabti</span>}
    </Link>
  );
}

/** The slash between two steps of the trail. */
export function AppSep() {
  return (
    <span className={styles.appSep} aria-hidden>
      /
    </span>
  );
}

/** One step of the trail: a link while it leads somewhere, the page while it is here. */
export function AppCrumb({
  href,
  children,
  testId,
}: {
  href?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return href ? (
    <Link href={href} className={styles.appCrumb} data-testid={testId}>
      {children}
    </Link>
  ) : (
    <span className={styles.appHere} aria-current="page" data-testid={testId}>
      {children}
    </span>
  );
}

/** An action of the bar: words, sentence case, no box until the pointer is on it. */
export function AppAction({
  href,
  className,
  ...rest
}: React.ComponentProps<typeof Link> & { href: string }) {
  return (
    <Link
      href={href}
      {...rest}
      className={[styles.appAction, className ?? ""].filter(Boolean).join(" ")}
    />
  );
}

/** The bar's place while a page loads, so the page under it does not jump. */
export function AppBarBlank() {
  return <div className={styles.appBar} />;
}
