import type { Metadata } from "next";
import { ProjectPanel } from "@/components/settings/ProjectPanel";
import { attachmentsOn } from "@/lib/attachments";

// The bucket is read from the environment of the running server, never the build's.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Project · Settings" };

export default function Page() {
  return <ProjectPanel files={attachmentsOn()} />;
}
