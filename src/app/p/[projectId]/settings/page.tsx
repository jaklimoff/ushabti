import { notFound, redirect } from "next/navigation";
import { getCurrentUser, requireMembership, HttpError } from "@/lib/auth";
import { loadBoard } from "@/lib/queries";
import { loadAgents } from "@/lib/agents";
import { Settings } from "@/components/settings/Settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
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

  const [board, agents] = await Promise.all([loadBoard(projectId, role), loadAgents(projectId)]);
  return <Settings initial={board} user={user} agents={agents} />;
}
