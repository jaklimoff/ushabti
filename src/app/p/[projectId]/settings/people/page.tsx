import type { Metadata } from "next";
import { PeoplePanel } from "@/components/settings/PeoplePanel";
import { mailIsOn } from "@/lib/mail";

// Mail is read from the environment of the running server, never the build's.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "People · Settings" };

export default function Page() {
  return <PeoplePanel mail={mailIsOn()} />;
}
