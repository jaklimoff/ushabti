import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listProjects } from "@/lib/queries";
import { ListEditor } from "@/components/lists/ListEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New list · Ushabti" };

/**
 * A list nobody has saved yet. It is written with its first project, so a
 * person who leaves before picking one leaves nothing behind.
 */
export default async function NewListRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const projects = await listProjects(user.id);
  return (
    <ListEditor
      user={user}
      list={null}
      sources={[]}
      projects={projects.map((p) => ({ id: p.id, key: p.key, name: p.name }))}
    />
  );
}
