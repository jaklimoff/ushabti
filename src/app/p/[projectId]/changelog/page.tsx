import { notFound, redirect } from "next/navigation";
import { getCurrentUser, requireMembership, HttpError } from "@/lib/auth";
import { readShown } from "@/lib/changelog";
import { changelogProject, loadChangelog } from "@/lib/changelog-load";
import { ChangelogList } from "@/components/changelog/ChangelogList";
import { Card, EmptyState, PageHead, PageShell } from "@/components/ui/Layout";
import { ProjectBar } from "@/components/ui/ProjectBar";
import styles from "@/components/changelog/changelog.module.css";

export const dynamic = "force-dynamic";

export const metadata = { title: "Changelog · Ushabti" };

/**
 * The changelog sits beside the archive because it reads the same record: a
 * ship archives what it shipped and dates the option. It reads no board, so
 * it is a server page with nothing to keep live.
 */
export default async function ChangelogPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ shown?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { projectId } = await params;
  try {
    await requireMembership(user.id, projectId);
  } catch (err) {
    if (err instanceof HttpError) notFound();
    throw err;
  }

  const log = await loadChangelog(projectId, readShown((await searchParams).shown));
  if (!log) {
    // A member was let in above, so the project is there and only releases are
    // off. Not found would tell them they cannot see it, which is false.
    const project = await changelogProject(projectId);
    if (!project) notFound();
    const { releaseBy: _off, ...named } = project;
    return (
      <div className={styles.page}>
        <ProjectBar project={named} here="Changelog" user={user} />
        <PageShell>
          <PageHead title="Changelog" />
          <Card>
            <EmptyState title="Releases are off" />
          </Card>
        </PageShell>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ProjectBar project={log.project} here="Changelog" user={user} />
      <PageShell>
        <PageHead
          title="Changelog"
          lead="Every release that shipped, newest first, with its note and its tasks. A note is written on its release in Settings."
        />
        {log.entries.length === 0 ? (
          <Card>
            <EmptyState title="Nothing has shipped yet">
              A column with a target date ships from its header, and lands here.
            </EmptyState>
          </Card>
        ) : (
          <div className={styles.entries}>
            <ChangelogList
              entries={log.entries}
              older={log.older}
              path={`/p/${log.project.id}/changelog`}
              projectId={log.project.id}
            />
          </div>
        )}
      </PageShell>
    </div>
  );
}
