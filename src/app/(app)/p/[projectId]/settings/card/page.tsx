import { redirect } from "next/navigation";

/** The default card sits at the top of Views now. Old links still land. */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/p/${projectId}/settings/views`);
}
