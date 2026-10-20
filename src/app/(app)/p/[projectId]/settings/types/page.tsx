import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getCurrentUser, requireMembership, HttpError } from "@/lib/auth";
import { propertySettingsHref } from "@/lib/board-roles";
import { loadProperties } from "@/lib/queries";
import { readTypeBy } from "@/lib/when";

export const dynamic = "force-dynamic";

/**
 * Types are set in a grid on the property that holds them, so the old page
 * sends a bookmark there. The pointer names a property id, so a stranger is
 * turned away before it is read.
 */
export default async function TypesRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { projectId } = await params;
  try {
    await requireMembership(user.id, projectId);
  } catch (err) {
    if (err instanceof HttpError) notFound();
    throw err;
  }

  const [row] = await db
    .select({ typeBy: projects.typeBy })
    .from(projects)
    .where(eq(projects.id, projectId));
  const typeBy = row ? readTypeBy(row.typeBy, await loadProperties(projectId)) : null;
  redirect(propertySettingsHref(projectId, typeBy));
}
