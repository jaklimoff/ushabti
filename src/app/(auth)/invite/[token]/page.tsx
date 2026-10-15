import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthCard, AuthForm } from "@/components/auth/AuthForm";
import { signupIsOpen } from "@/lib/auth";
import { forgotIsOn } from "@/lib/forgot";
import { INVITE_IS_DEAD } from "@/lib/invite-link";
import { inviteOfToken } from "@/lib/invites";
import { addressOf, limiter, signupByAddress } from "@/lib/rate-limit";
import styles from "@/components/auth/AuthForm.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join a project · Ushabti" };

/**
 * The page an invite link opens. The link is checked before a field is drawn,
 * as a reset link is, and a dead one gets one sentence and no form: it reads
 * the same whether the invite is old, spent, withdrawn or was never real.
 *
 * A dead link counts against the sign-up key the route uses, so this page is
 * no free oracle for walking tokens.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const key = signupByAddress(addressOf(await headers()));
  if (limiter.limited(key)) return <Dead />;

  const invite = await inviteOfToken(token);
  if (!invite) {
    limiter.hit(key);
    return <Dead />;
  }

  return (
    <AuthForm
      mode="register"
      signupOpen={signupIsOpen()}
      forgotOn={forgotIsOn()}
      invite={{ token, email: invite.email, project: invite.project }}
    />
  );
}

function Dead() {
  return (
    <AuthCard>
      <p className={styles.tagline} data-testid="invite-dead">
        {INVITE_IS_DEAD}
      </p>
    </AuthCard>
  );
}
