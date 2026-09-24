import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listProjects } from "@/lib/queries";
import { ProjectList } from "@/components/projects/ProjectList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Projects · Ushabti" };

/** `?new` arrives from **New project** in the switcher, and opens the one form. */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rows = await listProjects(user.id);
  const adding = (await searchParams).new !== undefined;
  return (
    <ProjectList
      user={user}
      adding={adding}
      projects={rows.map((r) => ({
        id: r.id,
        name: r.name,
        key: r.key,
        role: r.role,
        taskCount: r.taskCount,
        memberCount: r.memberCount,
      }))}
    />
  );
}
