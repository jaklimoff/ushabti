import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { AuthCard } from "@/components/auth/AuthForm";
import { ResetForm } from "@/components/auth/ResetForm";
import { addressOf, limiter, resetByAddress } from "@/lib/rate-limit";
import { forgotIsOn } from "@/lib/forgot";
import { deadLinkSaid } from "@/lib/reset-link";
import { accountOfToken } from "@/lib/resets";
import styles from "@/components/auth/AuthForm.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set a new password · Ushabti" };

/**
 * The link is checked here, before a field is drawn: somebody who was sent a
 * link that is spent should be told so, not after typing a password.
 *
 * A dead link gets one sentence and no form and no name. It reads the same
 * whether the token was used, is a day old, was replaced, or was never real,
 * so this page says nothing about who has an account here. The way back to
 * sign in is the same for every token too, so it reveals nothing, and the
 * page is never a dead end.
 *
 * It counts against the same key the route does. A page that answered "dead"
 * for nothing would be a free oracle: a guesser could walk tokens here and
 * only spend tries once one worked. Only a dead link counts, exactly as only
 * a wrong password does, so nobody following a link of their own is slowed.
 */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const key = resetByAddress(addressOf(await headers()));

  // Over the limit: the same sentence, and the token is never looked up. A
  // page cannot answer 429 without becoming a different page, and this one
  // has nothing else to say anyway.
  if (limiter.limited(key)) return <Dead />;

  const userId = await accountOfToken(token);
  if (!userId) {
    limiter.hit(key);
    return <Dead />;
  }

  return <ResetForm token={token} />;
}

function Dead() {
  const said = deadLinkSaid(forgotIsOn());
  // The words name a page, so the page is a press away. The sentence stays
  // plain text in `reset-link.ts`, because the route says it too.
  const [before, after] = said.split(FORGOT_WORDS);
  return (
    <AuthCard title="Link no longer works" below={<Link href="/login">Back to sign in</Link>}>
      <p className={styles.tagline} data-testid="reset-dead">
        {after === undefined ? (
          said
        ) : (
          <>
            {before}
            <Link href="/forgot" className={styles.inline}>
              {FORGOT_WORDS}
            </Link>
            {after}
          </>
        )}
      </p>
    </AuthCard>
  );
}

const FORGOT_WORDS = "Forgot password?";
