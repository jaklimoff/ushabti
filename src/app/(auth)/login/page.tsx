import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser, signupIsOpen } from "@/lib/auth";
import { forgotIsOn } from "@/lib/forgot";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in · Ushabti" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/projects");
  // A closed board says so here, rather than on a page one press away.
  return <AuthForm mode="login" signupOpen={signupIsOpen()} forgotOn={forgotIsOn()} />;
}
