import type { Metadata } from "next";
import { ImportPanel } from "@/components/settings/ImportPanel";

export const metadata: Metadata = { title: "Import · Settings" };

export default function Page() {
  return <ImportPanel />;
}
