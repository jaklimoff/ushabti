import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listProjects, listProjectsWithPulse, pulseBoards } from "@/lib/queries";
import { boardsOnce, listSummaries } from "@/lib/lists-load";
import { loadCharts } from "@/lib/charts-load";
import { ProjectList } from "@/components/projects/ProjectList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Home · Ushabti" };

/** `?new` arrives from **New project** in the sidebar, and opens the one form. */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const projects = await listProjects(user.id);
  /* The pulse and the charts read only a part of each board, all projects
     at once. A whole board is read only for a project a list draws tasks of. */
  const parts = pulseBoards(
    projects.map((p) => p.id),
    user.id,
  );
  const [rows, lists, charts] = await Promise.all([
    parts.then((read) => listProjectsWithPulse(user.id, projects, read)),
    listSummaries(user.id, projects, boardsOnce(user.id)),
    parts.then((read) => loadCharts(user.id, projects, async (row) => read.get(row.id))),
  ]);
  const adding = (await searchParams).new !== undefined;
  return (
    <ProjectList
      user={user}
      adding={adding}
      lists={lists}
      charts={charts.charts}
      chartChoices={charts.choices}
      projects={rows.map((r) => ({
        id: r.id,
        name: r.name,
        key: r.key,
        color: r.color,
        role: r.role,
        waiting: r.waiting,
        pulse: r.pulse,
      }))}
    />
  );
}
