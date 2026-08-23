import { notFound, redirect } from "next/navigation";
import { getCurrentUser, requireMembership, HttpError } from "@/lib/auth";
import { loadBoard } from "@/lib/queries";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { version } from "../../../../../package.json";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · Ushabti" };

export default async function SettingsLayout({
  params,
  children,
}: {
  params: Promise<{ projectId: string }>;
  children: React.ReactNode;
}) {
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

  const board = await loadBoard(projectId, role);
  return (
    <SettingsShell initial={board} user={user} version={version}>
      {children}
    </SettingsShell>
  );
}
