import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listProjects } from "@/lib/queries";
import { NewList } from "@/components/lists/NewList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New list · Ushabti" };

/**
 * A list nobody has saved yet. Nothing is written until Create, so a person
 * who leaves before it leaves nothing behind. The projects come in the
 * person's own Home order.
 */
export default async function NewListRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const projects = await listProjects(user.id);
  return (
    <NewList
      user={user}
      projects={projects.map((p) => ({ id: p.id, key: p.key, name: p.name, color: p.color }))}
    />
  );
}
