import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { forgotIsOn } from "@/lib/forgot";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in · Ushabti" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/projects");
  return <AuthForm mode="login" forgotOn={forgotIsOn()} />;
}
