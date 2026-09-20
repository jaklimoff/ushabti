import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthForm";
import { ResetForm } from "@/components/auth/ResetForm";
import { LINK_IS_DEAD } from "@/lib/reset-link";
import { accountOfToken } from "@/lib/resets";
import styles from "@/components/auth/AuthForm.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set a new password · Ushabti" };

/**
 * The link is checked here, before a field is drawn: somebody who was sent a
 * link that is spent should be told so, not after typing a password.
 *
 * A dead link gets one sentence and nothing else — no form, no sign-in link,
 * no name. It reads the same whether the token was used, is a day old, was
 * replaced, or was never real, so this page says nothing about who has an
 * account here.
 */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const userId = await accountOfToken(token);

  if (!userId) {
    return (
      <AuthCard>
        <p className={styles.tagline}>{LINK_IS_DEAD}</p>
      </AuthCard>
    );
  }

  return <ResetForm token={token} />;
}
