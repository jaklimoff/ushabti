"use client";

import { AppAction, AppBar, AppCrumb } from "./AppBar";
import { ProjectMark } from "./Marks";
import { SidebarMark } from "./Sidebar";
import type { SessionUser } from "./UserMenu";
import styles from "./ui.module.css";

/**
 * The bar at the top of a project page that is not the board.
 *
 * Settings wore it first and the archive wears the same one, because the two
 * pages sit beside each other and a second bar would end up at a second
 * height. It is the shared `AppBar`, so the Ushabti mark still leads home. It
 * says where you are, and it always offers the way back. The name switches
 * projects, as it does on the board; **Back to board** is the one way back,
 * so the name is not a second one.
 */
export function ProjectBar({
  project,
  here,
  user,
}: {
  project: { id: string; key: string; name: string; color?: string };
  here: string;
  user: SessionUser;
}) {
  return (
    <AppBar
      user={user}
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
      actions={<AppAction href={`/p/${project.id}`}>Back to board</AppAction>}
    />
  );
}
