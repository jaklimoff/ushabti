import type { Metadata } from "next";
import { CardViewPanel } from "@/components/settings/CardViewPanel";

export const metadata: Metadata = { title: "Card view · Views · Settings" };

export default async function Page({ params }: { params: Promise<{ viewId: string }> }) {
  const { viewId } = await params;
  return <CardViewPanel viewId={viewId} />;
}
