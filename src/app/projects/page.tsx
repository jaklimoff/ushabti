import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listProjects } from "@/lib/queries";
import { ProjectList } from "@/components/projects/ProjectList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Projects · Ushabti" };

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rows = await listProjects(user.id);
  return (
    <ProjectList
      user={user}
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
