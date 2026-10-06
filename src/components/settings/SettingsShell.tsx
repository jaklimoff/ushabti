"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectBar } from "@/components/ui/ProjectBar";
import type { SessionUser } from "@/components/ui/UserMenu";
import { Toasts } from "@/components/ui/Toasts";
import { Note } from "@/components/ui/Layout";
import { BoardProvider, useBoard } from "@/components/board/store";
import { canManage } from "@/lib/roles";
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
  const rail = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);

  /* On a phone the rail is one scrolled line with no scrollbar, so it fades
     while there is more, and the page that opens brings its item into view.
     The rail is moved by hand: scrollIntoView would scroll the page too. */
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const here = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (here && el.scrollWidth > el.clientWidth) {
      const from = el.getBoundingClientRect();
      const to = here.getBoundingClientRect();
      if (to.left < from.left || to.right > from.right) {
        el.scrollLeft += to.left - from.left - (from.width - to.width) / 2;
      }
    }
    const measure = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    /* The rail and its items change width without a window resize: a count
       grows, a font arrives. */
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    for (const item of el.children) sizes.observe(item);
    return () => {
      el.removeEventListener("scroll", measure);
      sizes.disconnect();
    };
  }, [pathname]);

  const items = [
    { slug: "properties", label: "Properties", count: data.properties.length },
    /* The number of types is the number of options of the select the project
       names as its Type, and none while it names nothing. */
    {
      slug: "types",
      label: "Types",
      count: data.properties.find((p) => p.id === data.project.typeBy)?.options.length ?? 0,
    },
    { slug: "card", label: "Card view", count: null },
    { slug: "views", label: "Views", count: data.views.length },
    { slug: "people", label: "People", count: data.members.length },
    /* A URL and a secret are access, so the read is an admin's too. A member
       who cannot see the page is not offered it. */
    /* An import makes properties and options, and the shape of a project is
       an admin's. A member who cannot press the button is not offered the
       page that leads to it. */
    ...(canManage(data.project.role)
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
        <nav
          ref={rail}
          className={styles.rail}
          aria-label="Settings sections"
          data-more={more || undefined}
        >
          {items.map((item) => {
            const href = `${base}/${item.slug}`;
            /* A view's card view sits under its view, and lights Views. */
            const on = pathname === href || pathname.startsWith(`${href}/`);
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
      <Note>{note}</Note>
    </div>
  );
}
