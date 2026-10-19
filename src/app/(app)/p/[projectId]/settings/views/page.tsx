import type { Metadata } from "next";
import { ViewsPanel } from "@/components/settings/ViewsPanel";

export const metadata: Metadata = { title: "Views · Settings" };

export default function Page() {
  return <ViewsPanel />;
}
