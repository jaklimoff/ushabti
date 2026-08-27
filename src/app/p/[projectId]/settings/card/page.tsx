import type { Metadata } from "next";
import { CardViewPanel } from "@/components/settings/CardViewPanel";

export const metadata: Metadata = { title: "Card view · Settings" };

export default function Page() {
  return <CardViewPanel />;
}
