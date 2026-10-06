import type { Metadata } from "next";
import { TypesPanel } from "@/components/settings/TypesPanel";

export const metadata: Metadata = { title: "Types · Settings" };

export default function Page() {
  return <TypesPanel />;
}
