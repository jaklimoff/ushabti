import { redirect } from "next/navigation";

/** A view's card is picked on the Card page, so an old link opens it there. */
export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; viewId: string }>;
}) {
  const { projectId, viewId } = await params;
  redirect(`/p/${projectId}/settings/card?of=${encodeURIComponent(viewId)}`);
}
