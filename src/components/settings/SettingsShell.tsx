"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu, type SessionUser } from "@/components/ui/UserMenu";
import { Toasts } from "@/components/ui/Toasts";
import { BoardProvider, useBoard } from "@/components/board/store";
import type { BoardData } from "@/lib/types";
import styles from "./settings.module.css";

export function SettingsShell({
  initial,
  user,
  version,
  children,
}: {
  initial: BoardData;
  user: SessionUser;
  version: string;
  children: React.ReactNode;
}) {
  return (
    <BoardProvider initial={initial} user={user}>
      <Chrome version={version}>{children}</Chrome>
    </BoardProvider>
  );
}

function Chrome({ version, children }: { version: string; children: React.ReactNode }) {
  const { data, user, toasts } = useBoard();
  const pathname = usePathname();
  const base = `/p/${data.project.id}/settings`;

  const items = [
    { slug: "properties", label: "Properties", count: data.properties.length },
    { slug: "card", label: "Card view", count: null },
    { slug: "views", label: "Views", count: data.views.length },
    { slug: "people", label: "People", count: data.members.length },
    { slug: "project", label: "Project", count: null },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <div className={styles.mark}>{data.project.key.slice(0, 1)}</div>
        <Link href={`/p/${data.project.id}`} className={styles.crumb}>
          {data.project.name}
        </Link>
        <span className={styles.sep}>/</span>
        <span className={styles.here}>Settings</span>
        <span style={{ flex: 1 }} />
        <Link href={`/p/${data.project.id}`} className={styles.back}>
          Back to board
        </Link>
        <UserMenu user={user} />
      </div>

      <div className={styles.shell}>
        <nav className={styles.rail} aria-label="Settings sections">
          {items.map((item) => {
            const href = `${base}/${item.slug}`;
            const on = pathname === href;
            return (
              <Link
                key={item.slug}
                href={href}
                aria-current={on ? "page" : undefined}
                className={`${styles.railItem} ${on ? styles.railOn : ""}`}
              >
                {item.label}
                {item.count !== null && <span className={styles.railCount}>{item.count}</span>}
              </Link>
            );
          })}
          <div className={styles.railFoot}>
            <a
              className={styles.railLink}
              href="https://github.com/jaklimoff/ushabti/blob/main/docs/agents.md"
              target="_blank"
              rel="noreferrer"
            >
              How agents work
            </a>
            <span className={styles.railVersion}>Ushabti {version}</span>
          </div>
        </nav>

        <div className={styles.body}>{children}</div>
      </div>

      <Toasts toasts={toasts} />
    </div>
  );
}

/** The title and the sentence at the top of each settings page. */
export function PageHead({ title, note }: { title: string; note: React.ReactNode }) {
  return (
    <div className={styles.pageHead}>
      <h1 className={styles.h1}>{title}</h1>
      <span style={{ fontSize: 12, lineHeight: 1.55, color: "var(--muted)" }}>{note}</span>
    </div>
  );
}
