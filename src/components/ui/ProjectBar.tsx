"use client";

import { AppAction, AppBar, AppCrumb, useHomeInBar } from "./AppBar";
import { ProjectMark } from "./Marks";
import { SidebarMark } from "./Sidebar";
import type { SessionUser } from "./UserMenu";
import styles from "./ui.module.css";

/**
 * The bar at the top of a project page that is not the board.
 *
 * Settings wore it first and the archive wears the same one, because the two
 * pages sit beside each other and a second bar would end up at a second
 * height. It is the shared `AppBar`, and it opens on the project: the sidebar
 * leads Home, so the Ushabti mark comes back only where no sidebar is drawn.
 * It says where you are, and it always offers the way back. The project's
 * name is a crumb, and a crumb people click has to lead somewhere, so it leads
 * to the board as **Back to board** does, to the same place. Settings names
 * the view it was opened from, so both land where the person left. On a phone
 * the mark opens the sidebar's sheet instead, and the name is not drawn.
 *
 * Before it sit the board's own sibling links — Archived, Changelog while
 * releases are on, Settings — with this page's marked, so the three pages
 * off the board reach each other without the board between them. A phone
 * keeps only the way back, as the board's bar gives up its links there.
 */
export function ProjectBar({
  project,
  here,
  user,
  back,
}: {
  project: { id: string; key: string; name: string; color?: string; releaseBy?: string | null };
  here: string;
  user: SessionUser;
  back?: { id: string; name: string } | null;
}) {
  const releases = Boolean(project.releaseBy) || here === "Changelog";
  const board = back ? `/p/${project.id}?view=${encodeURIComponent(back.id)}` : `/p/${project.id}`;
  const siblings = [
    { word: "Archived", href: `/p/${project.id}/archived` },
    ...(releases ? [{ word: "Changelog", href: `/p/${project.id}/changelog` }] : []),
    { word: "Settings", href: `/p/${project.id}/settings/properties` },
  ];
  return (
    <AppBar
      user={user}
      home={useHomeInBar()}
      word={false}
      trail={[
        <SidebarMark key="project" href={board}>
          <ProjectMark projectKey={project.key} color={project.color ?? "var(--accent)"} />
          <span className={styles.projCrumb} data-testid="project-crumb">
            {project.name}
          </span>
        </SidebarMark>,
        <AppCrumb key="here">{here}</AppCrumb>,
      ]}
      actions={
        <>
          {siblings.map((sibling) => (
            <AppAction
              key={sibling.word}
              href={sibling.href}
              current={sibling.word === here}
              className={styles.appSibling}
            >
              {sibling.word}
            </AppAction>
          ))}
          <span className={styles.appActionsSep} aria-hidden="true" />
          <AppAction back href={board}>
            Back to {back ? back.name : "board"}
          </AppAction>
        </>
      }
    />
  );
}
