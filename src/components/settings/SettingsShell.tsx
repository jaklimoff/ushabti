"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectBar } from "@/components/ui/ProjectBar";
import type { SessionUser } from "@/components/ui/UserMenu";
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
    /* A URL and a secret are access, so the read is the owner's too. A member
       who cannot see the page is not offered it. */
    /* An import makes properties and options, and the shape of a project is
       the owner's. A member who cannot press the button is not offered the
       page that leads to it. */
    ...(data.project.role === "owner"
      ? [
          { slug: "webhooks", label: "Webhooks", count: null },
          { slug: "import", label: "Import", count: null },
        ]
      : []),
    { slug: "project", label: "Project", count: null },
  ];

  return (
    <div className={styles.page}>
      <ProjectBar project={data.project} here="Settings" user={user} />

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
