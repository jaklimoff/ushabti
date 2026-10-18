"use client";

import { Fragment } from "react";
import Link from "next/link";
import { BrandMark } from "./Marks";
import { UserMenu, type SessionUser } from "./UserMenu";
import styles from "./ui.module.css";

/**
 * The one bar at the top of every page off the board. There used to be five,
 * at two paddings and two gaps, so the mark moved between pages and only some
 * of them led home. Here the Ushabti mark always links Home, the trail says
 * where you are, and the actions are quiet words at the end.
 *
 * `word` keeps the name Ushabti beside the mark. A project page drops it: the
 * project's own name is the one that matters there.
 */
export function AppBar({
  user,
  trail = [],
  actions,
  word = true,
  homeTestId,
}: {
  user: SessionUser;
  /** What comes after the mark, left to right. The last is where you are. */
  trail?: React.ReactNode[];
  actions?: React.ReactNode;
  word?: boolean;
  homeTestId?: string;
}) {
  return (
    <header className={styles.appBar}>
      <nav className={styles.appTrail} aria-label="Where you are">
        <Link
          href="/projects"
          className={styles.appHome}
          title="Home"
          aria-label={word ? undefined : "Home"}
          data-testid={homeTestId}
        >
          <BrandMark />
          {word && <span className={styles.appBrand}>Ushabti</span>}
        </Link>
        {trail.map((item, i) => (
          <Fragment key={i}>
            <span className={styles.appSep} aria-hidden>
              /
            </span>
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
