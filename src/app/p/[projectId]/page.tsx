import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, requireMembership, HttpError } from "@/lib/auth";
import { loadBoard } from "@/lib/queries";
import { BoardApp } from "@/components/board/BoardApp";

export const dynamic = "force-dynamic";

/** The tab says which board it is, so three open boards can be told apart. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const user = await getCurrentUser();
  if (!user) return { title: "Ushabti" };
  const { projectId } = await params;
  try {
    const { projectName } = await requireMembership(user.id, projectId);
    return { title: `${projectName} · Ushabti` };
  } catch {
    return { title: "Ushabti" };
  }
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { projectId } = await params;
  const { task } = await searchParams;

  let role: string;
  try {
    role = (await requireMembership(user.id, projectId)).role;
  } catch (err) {
    if (err instanceof HttpError) notFound();
    throw err;
  }

  const board = await loadBoard(projectId, role);
  return <BoardApp initial={board} user={user} initialTask={task ?? null} />;
}
