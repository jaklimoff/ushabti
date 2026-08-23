import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser, signupIsOpen } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create an account · Ushabti" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/projects");
  return <AuthForm mode="register" signupOpen={signupIsOpen()} />;
}
