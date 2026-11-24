import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listProjects } from "@/lib/queries";
import { setupLine } from "@/lib/setup-copy";
import { setupSummaries } from "@/lib/setup-write";
import { NewProject, type SetupSource } from "@/components/projects/NewProject";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New project · Ushabti" };

/** A project nobody has made yet. Nothing is written until Create project. */
export default async function NewProjectRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  /* In the person's Home order, each with the line that says what it brings. */
  const mine = await listProjects(user.id);
  const summaries = await setupSummaries(mine.map((p) => p.id));
  const sources: SetupSource[] = mine.flatMap((p) => {
    const summary = summaries.get(p.id);
    return summary
      ? [{ id: p.id, key: p.key, name: p.name, color: p.color, line: setupLine(summary) }]
      : [];
  });
  return <NewProject user={user} sources={sources} />;
}
