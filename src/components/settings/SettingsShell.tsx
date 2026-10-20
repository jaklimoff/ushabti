"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ProjectBar } from "@/components/ui/ProjectBar";
import type { SessionUser } from "@/components/ui/UserMenu";
import { Toasts } from "@/components/ui/Toasts";
import { PageHead as SharedPageHead } from "@/components/ui/Layout";
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
    <BoardProvider initial={initial} user={user} reads="settings">
      <Chrome version={version}>{children}</Chrome>
    </BoardProvider>
  );
}

function Chrome({ version, children }: { version: string; children: React.ReactNode }) {
  const { data, user, toasts } = useBoard();
  const pathname = usePathname();
  const base = `/p/${data.project.id}/settings`;
  /* The view the board was on when Settings opened. It rides in the address
     so a reload keeps it, and the rail hands it on. A view that is gone
     reads as no view at all. */
  const fromId = useSearchParams().get("from");
  const from = data.views.find((v) => v.id === fromId) ?? null;
  const carry = from ? `?from=${encodeURIComponent(from.id)}` : "";
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
    for (const item of el.querySelectorAll("a")) sizes.observe(item);
    return () => {
      el.removeEventListener("scroll", measure);
      sizes.disconnect();
    };
  }, [pathname]);

  /* Three groups, so the eye finds a page by what it is about: the project
     and its people first, which is what a newcomer comes to change, then the
     shape of the board, then what goes in and out of it. */
  const groups: RailGroup[] = [
    {
      title: "General",
      items: [
        { slug: "project", label: "Project", count: null },
        { slug: "people", label: "People", count: data.members.length },
      ],
    },
    {
      title: "Shape",
      items: [
        { slug: "properties", label: "Properties", count: data.properties.length },
        /* The number of types is the number of options of the select the
           project names as its Type, and none while it names nothing. */
        {
          slug: "types",
          label: "Types",
          count: data.properties.find((p) => p.id === data.project.typeBy)?.options.length ?? 0,
        },
        { slug: "card", label: "Card view", count: null },
        { slug: "views", label: "Views", count: data.views.length },
      ],
    },
    /* A URL and a secret are access, so the read is an admin's too. An import
       makes properties and options, and the shape of a project is an admin's.
       A member who cannot press the button is not offered the page. */
    ...(canManage(data.project.role)
      ? [
          {
            title: "Integrations",
            items: [
              { slug: "webhooks", label: "Webhooks", count: null },
              { slug: "import", label: "Import and export", count: null },
            ],
          },
        ]
      : []),
  ];

  return (
    <div className={styles.page}>
      <ProjectBar project={data.project} here="Settings" user={user} back={from} />

      <div className={styles.shell}>
        <nav
          ref={rail}
          className={styles.rail}
          aria-label="Settings sections"
          data-more={more || undefined}
        >
          {groups.map((group) => (
            <div
              key={group.title}
              role="group"
              aria-labelledby={`rail-${group.title}`}
              className={styles.railGroup}
            >
              <span id={`rail-${group.title}`} className={styles.railGroupTitle}>
                {group.title}
              </span>
              {group.items.map((item) => {
                const href = `${base}/${item.slug}`;
                /* A view's card view sits under its view, and lights Views. */
                const on = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={item.slug}
                    href={href + carry}
                    aria-current={on ? "page" : undefined}
                    className={`${styles.railItem} ${on ? styles.railOn : ""}`}
                  >
                    {item.label}
                    {/* None of a thing reads as nothing, not as a zero to count. */}
                    {item.count ? <span className={styles.railCount}>{item.count}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className={styles.railFoot}>
            <a
              className={styles.railLink}
              href="https://github.com/jaklimoff/ushabti/blob/main/docs/agents.md"
              target="_blank"
              rel="noreferrer"
            >
              How agents work
              <span aria-hidden="true"> ↗</span>
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

type RailGroup = {
  title: string;
  items: { slug: string; label: string; count: number | null }[];
};

/** The title and the sentence at the top of each settings page. */
export function PageHead({ title, note }: { title: React.ReactNode; note: React.ReactNode }) {
  return <SharedPageHead title={title} lead={note} />;
}
