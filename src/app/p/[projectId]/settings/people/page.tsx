import type { Metadata } from "next";
import { PeoplePanel } from "@/components/settings/PeoplePanel";

export const metadata: Metadata = { title: "People · Settings" };

export default function Page() {
  return <PeoplePanel />;
}
