import { redirect } from "next/navigation";

/** A view's card is edited in its own row on Views, so the link opens it. */
export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; viewId: string }>;
}) {
  const { projectId, viewId } = await params;
  redirect(`/p/${projectId}/settings/views?open=${encodeURIComponent(viewId)}`);
}
