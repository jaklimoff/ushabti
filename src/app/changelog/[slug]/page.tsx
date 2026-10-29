import { cache } from "react";
import { notFound } from "next/navigation";
import { changelogSlug, readShown } from "@/lib/changelog";
import { loadPublicChangelog } from "@/lib/changelog-load";
import { ChangelogList } from "@/components/changelog/ChangelogList";
import { Card, EmptyState, PageHead, PageShell } from "@/components/ui/Layout";
import { BrandMark } from "@/components/ui/Marks";
import styles from "@/components/changelog/changelog.module.css";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ shown?: string | string[] }>;
};

/** Where a stranger who liked the page finds the thing that drew it. */
const USHABTI = "https://github.com/jaklimoff/ushabti";

/* The title and the page ask once between them. */
const read = cache(loadPublicChangelog);

export async function generateMetadata({ params, searchParams }: Props) {
  const log = await read((await params).slug, readShown((await searchParams).shown));
  return { title: log ? `${log.project.name} · Changelog` : "Not found" };
}

/**
 * The changelog a stranger reads. It asks for no session and reads no board:
 * its own loader answers only for a project that turned it on, and the
 * answer carries no key, no person and no id, so nothing here can lead back
 * into the board.
 *
 * It is still drawn on every visit, because its address carries `?shown=`,
 * but what it draws is kept between visits and read again only after the
 * project changes.
 */
export default async function PublicChangelogPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const log = await read(slug, readShown((await searchParams).shown));
  if (!log) notFound();

  return (
    <div className={styles.page}>
      {/* A stranger has no account here, so the bar names the project and
          offers nothing to sign in to. The mark says whose page this is, as
          it does on every other page of ours a stranger sees. */}
      <header className={styles.publicBar}>
        <BrandMark />
        <span className={styles.publicName}>{log.project.name}</span>
        <span className={styles.publicSep} aria-hidden>
          /
        </span>
        <span className={styles.publicHere}>Changelog</span>
      </header>
      <PageShell className={styles.publicShell}>
        <PageHead title="Changelog" lead={`What shipped in ${log.project.name}, newest first.`} />
        {log.entries.length === 0 ? (
          <Card>
            <EmptyState title="Nothing has shipped yet" />
          </Card>
        ) : (
          <div className={styles.entries}>
            <ChangelogList
              entries={log.entries}
              older={log.older}
              path={`/changelog/${changelogSlug(slug)}`}
            />
          </div>
        )}
      </PageShell>
      <footer className={styles.publicFoot}>
        Kept with{" "}
        <a className={styles.publicFootLink} href={USHABTI}>
          Ushabti
        </a>
      </footer>
    </div>
  );
}
