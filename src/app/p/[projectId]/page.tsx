import { notFound, redirect } from "next/navigation";
import { getCurrentUser, requireMembership, HttpError } from "@/lib/auth";
import { loadBoard } from "@/lib/queries";
import { BoardApp } from "@/components/board/BoardApp";

export const dynamic = "force-dynamic";

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
  return <BoardApp initial={board} user={user} initialTaskId={task ?? null} />;
}
