import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { boardsOnce, findList, sourceShape, sourcesOf } from "@/lib/lists-load";
import { listProjects } from "@/lib/queries";
import { ListEditor } from "@/components/lists/ListEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit list · Ushabti" };

/**
 * Making a list. A source of a project the person left is not drawn: its
 * properties are not theirs to read any more. It is kept, and comes back
 * when they rejoin.
 */
export default async function EditListRoute({ params }: { params: Promise<{ listId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const list = await findList((await params).listId, user.id);
  if (!list) notFound();

  const [sources, projects] = await Promise.all([sourcesOf([list.id]), listProjects(user.id)]);
  const boardOf = boardsOnce(user.id);
  const shapes = await Promise.all(
    sources.flatMap((source) => {
      const row = projects.find((p) => p.id === source.projectId);
      return row ? [sourceShape(source, row, boardOf)] : [];
    }),
  );
  return (
    <ListEditor
      user={user}
      list={list}
      sources={shapes}
      hidden={sources.length - shapes.length}
      projects={projects.map((p) => ({ id: p.id, key: p.key, name: p.name }))}
    />
  );
}
