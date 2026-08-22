import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/projects");
  return <AuthForm mode="login" />;
}
