import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listGroups } from "@/lib/lists";
import { boardsFor, boardsOnce, findList, sourcesOf } from "@/lib/lists-load";
import { listProjects } from "@/lib/queries";
import { ListPage } from "@/components/lists/ListPage";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ listId: string }>;
}): Promise<Metadata> {
  const user = await getCurrentUser();
  const list = user ? await findList((await params).listId, user.id) : null;
  return { title: list ? `${list.name} · Ushabti` : "Ushabti" };
}

/** A list, read afresh on every load. Nothing on it changes a task. */
export default async function ListRoute({ params }: { params: Promise<{ listId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const list = await findList((await params).listId, user.id);
  if (!list) notFound();

  const [sources, projects] = await Promise.all([sourcesOf([list.id]), listProjects(user.id)]);
  const boards = await boardsFor(sources, projects, boardsOnce(user.id));
  return <ListPage user={user} list={list} groups={listGroups(sources, boards, user.id)} />;
}
