import { redirect } from "next/navigation";

/** Properties is the reason people open settings, so it is the front page. */
export default async function SettingsIndex({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/p/${projectId}/settings/properties`);
}
