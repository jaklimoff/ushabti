import { notFound, redirect } from "next/navigation";
import { getCurrentUser, requireMembership, HttpError } from "@/lib/auth";
import { loadChangelog } from "@/lib/changelog-load";
import { ChangelogList } from "@/components/changelog/ChangelogList";
import { EmptyState } from "@/components/ui/Layout";
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
}: {
  params: Promise<{ projectId: string }>;
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

  const log = await loadChangelog(projectId);
  if (!log) notFound();

  return (
    <div className={styles.page}>
      <ProjectBar project={log.project} here="Changelog" user={user} />
      <div className={styles.shell}>
        <h1 className={styles.h1}>Changelog</h1>
        <span className={styles.lead}>
          Every option that shipped, newest first, with its note and its tasks. A note is edited on
          its option in Settings.
        </span>
        {log.entries.length === 0 ? (
          <EmptyState title="Nothing has shipped yet">
            A column with a target date ships from its header, and lands here.
          </EmptyState>
        ) : (
          <ChangelogList entries={log.entries} projectId={log.project.id} />
        )}
      </div>
    </div>
  );
}
