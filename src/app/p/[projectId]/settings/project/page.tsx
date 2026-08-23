import type { Metadata } from "next";
import { ProjectPanel } from "@/components/settings/ProjectPanel";

export const metadata: Metadata = { title: "Project · Settings" };

export default function Page() {
  return <ProjectPanel />;
}
