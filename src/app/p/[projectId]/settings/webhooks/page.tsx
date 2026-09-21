import type { Metadata } from "next";
import { WebhooksPanel } from "@/components/settings/WebhooksPanel";

export const metadata: Metadata = { title: "Webhooks · Settings" };

export default function Page() {
  return <WebhooksPanel />;
}
