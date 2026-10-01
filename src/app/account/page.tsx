import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { forgotIsOn } from "@/lib/forgot";
import { Account } from "@/components/account/Account";
import { version } from "../../../package.json";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account · Ushabti" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // An ask is emailed only when the server can build its link, as a forgot email is.
  return <Account user={user} version={version} askMailOn={forgotIsOn()} />;
}
