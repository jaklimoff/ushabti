import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { NewProject } from "@/components/projects/NewProject";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New project · Ushabti" };

/** A project nobody has made yet. Nothing is written until Create project. */
export default async function NewProjectRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <NewProject user={user} />;
}
