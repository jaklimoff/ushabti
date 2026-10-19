import type { Metadata } from "next";
import { PropertiesPanel } from "@/components/settings/PropertiesPanel";

export const metadata: Metadata = { title: "Properties · Settings" };

export default function Page() {
  return <PropertiesPanel />;
}
