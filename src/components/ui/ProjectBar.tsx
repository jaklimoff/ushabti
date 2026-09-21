"use client";

import Link from "next/link";
import { UserMenu, type SessionUser } from "./UserMenu";
import styles from "./ui.module.css";

/**
 * The bar at the top of a project page that is not the board.
 *
 * Settings wore it first and the archive wears the same one, because the two
 * pages sit beside each other and a second bar would end up at a second
 * height. It says where you are, and it always offers the way back.
 */
export function ProjectBar({
  project,
  here,
  user,
}: {
  project: { id: string; key: string; name: string };
  here: string;
  user: SessionUser;
}) {
  return (
    <div className={styles.projTop}>
      <div className={styles.projMark}>{project.key.slice(0, 1)}</div>
      <Link href={`/p/${project.id}`} className={styles.projCrumb}>
        {project.name}
      </Link>
      <span className={styles.projSep}>/</span>
      <span className={styles.projHere}>{here}</span>
      <span style={{ flex: 1 }} />
      <Link href={`/p/${project.id}`} className={styles.projBack}>
        Back to board
      </Link>
      <UserMenu user={user} />
    </div>
  );
}
