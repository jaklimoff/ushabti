import type { Metadata } from "next";
import { CardPanel } from "@/components/settings/CardViewPanel";

export const metadata: Metadata = { title: "Card · Settings" };

export default function Page() {
  return <CardPanel />;
}
