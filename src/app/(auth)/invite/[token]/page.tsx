import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { AuthCard, AuthForm } from "@/components/auth/AuthForm";
import { JoinInvite } from "@/components/auth/JoinInvite";
import { getCurrentUser, signupIsOpen } from "@/lib/auth";
import { forgotIsOn } from "@/lib/forgot";
import { INVITE_IS_DEAD } from "@/lib/invite-link";
import { inviteIsForAnother, inviteOfToken } from "@/lib/invites";
import { addressOf, limiter, signupByAddress } from "@/lib/rate-limit";
import styles from "@/components/auth/AuthForm.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join a project · Ushabti" };

/**
 * The page an invite link opens. The link is checked before a field is drawn,
 * as a reset link is, and a dead one gets one sentence and no form: it reads
 * the same whether the invite is old, spent, withdrawn or was never real. The
 * way back to sign in is the same for every token, so it reveals nothing.
 *
 * A dead link counts against the sign-up key the route uses, so this page is
 * no free oracle for walking tokens.
 *
 * A live link asks one of three things. Signed in as its email, it offers a
 * button that joins. Signed in as anybody else, it says whom the invite is for
 * and joins nothing. Signed out, it draws one form whatever the email: sign
 * in and join, with a switch to make an account instead. It never asks
 * whether the email has an account, because the inviter holds the link too,
 * and a page that drew two forms would tell them.
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

  const me = await getCurrentUser();
  if (me && me.email === invite.email) {
    return (
      <AuthCard title={`Join ${invite.project}`} below={<Link href="/projects">Not now</Link>}>
        <p className={styles.notice} data-testid="invite-tagline">
          Invited as {invite.email}. You are signed in as that email.
        </p>
        <JoinInvite token={token} project={invite.project} />
      </AuthCard>
    );
  }
  if (me) {
    return (
      <AuthCard
        title="This invite is for another email"
        below={<Link href="/projects">Back to your projects</Link>}
      >
        <p className={styles.tagline} data-testid="invite-other">
          {inviteIsForAnother(invite.email)} You are signed in as {me.email}, so this account does
          not join.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthForm
      mode="login"
      signupOpen={signupIsOpen()}
      forgotOn={forgotIsOn()}
      invite={{ token, email: invite.email, project: invite.project }}
    />
  );
}

function Dead() {
  return (
    <AuthCard title="Invite no longer works" below={<Link href="/login">Back to sign in</Link>}>
      <p className={styles.tagline} data-testid="invite-dead">
        {INVITE_IS_DEAD}
      </p>
    </AuthCard>
  );
}
