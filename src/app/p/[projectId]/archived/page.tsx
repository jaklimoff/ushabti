import { notFound, redirect } from "next/navigation";
import { getCurrentUser, requireMembership, HttpError } from "@/lib/auth";
import { loadBoard } from "@/lib/queries";
import { Archive } from "@/components/archive/Archive";

export const dynamic = "force-dynamic";

export const metadata = { title: "Archive · Ushabti" };

/**
 * The archive sits beside Settings rather than in the view strip: it is not a
 * view, and no view draws an archived task. It reads the board the way every
 * other project page does, because the archived rows arrive with it.
 */
export default async function ArchivedPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { projectId } = await params;

  let role: string;
  try {
    role = (await requireMembership(user.id, projectId)).role;
  } catch (err) {
    if (err instanceof HttpError) notFound();
    throw err;
  }

  const board = await loadBoard(projectId, role, user.id);
  return <Archive initial={board} user={user} />;
}
