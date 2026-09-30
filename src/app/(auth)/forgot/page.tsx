import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ForgotForm } from "@/components/auth/ForgotForm";
import { getCurrentUser } from "@/lib/auth";
import { forgotIsOn } from "@/lib/forgot";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forgot password · Ushabti" };

export default async function ForgotPage() {
  if (await getCurrentUser()) redirect("/projects");
  return <ForgotForm on={forgotIsOn()} />;
}
