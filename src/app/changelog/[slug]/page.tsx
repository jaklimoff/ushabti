import { cache } from "react";
import { notFound } from "next/navigation";
import { loadPublicChangelog } from "@/lib/changelog-load";
import { ChangelogList } from "@/components/changelog/ChangelogList";
import { EmptyState } from "@/components/ui/Layout";
import styles from "@/components/changelog/changelog.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/* The title and the page ask once between them. */
const read = cache(loadPublicChangelog);

export async function generateMetadata({ params }: Props) {
  const log = await read((await params).slug);
  return { title: log ? `${log.project.name} · Changelog` : "Not found" };
}

/**
 * The changelog a stranger reads. It asks for no session and reads no board:
 * its own loader answers only for a project that turned it on, and the
 * answer carries no key, no person and no id, so nothing here can lead back
 * into the board.
 */
export default async function PublicChangelogPage({ params }: Props) {
  const log = await read((await params).slug);
  if (!log) notFound();

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <h1 className={styles.h1}>{log.project.name}</h1>
        <span className={styles.lead}>Changelog</span>
        {log.entries.length === 0 ? (
          <EmptyState title="Nothing has shipped yet" />
        ) : (
          <ChangelogList entries={log.entries} />
        )}
      </div>
    </div>
  );
}
