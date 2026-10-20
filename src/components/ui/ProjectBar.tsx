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
 * leads Home, so the Ushabti mark comes back only where no sidebar is drawn. It says where you are, and it
 * always offers the way back. The name switches
 * projects, as it does on the board; **Back to board** is the one way back,
 * so the name is not a second one. Settings names the view it was opened
 * from instead, so the way back lands where the person left.
 */
export function ProjectBar({
  project,
  here,
  user,
  back,
}: {
  project: { id: string; key: string; name: string; color?: string };
  here: string;
  user: SessionUser;
  back?: { id: string; name: string } | null;
}) {
  return (
    <AppBar
      user={user}
      home={useHomeInBar()}
      word={false}
      trail={[
        <SidebarMark key="project">
          <ProjectMark projectKey={project.key} color={project.color ?? "var(--accent)"} />
          <span className={styles.projCrumb} data-testid="project-crumb">
            {project.name}
          </span>
        </SidebarMark>,
        <AppCrumb key="here">{here}</AppCrumb>,
      ]}
      actions={
        back ? (
          <AppAction href={`/p/${project.id}?view=${encodeURIComponent(back.id)}`}>
            Back to {back.name}
          </AppAction>
        ) : (
          <AppAction href={`/p/${project.id}`}>Back to board</AppAction>
        )
      }
    />
  );
}
