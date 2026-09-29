"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { FORGOT_OFF, FORGOT_SENT } from "@/lib/reset-link";
import { AuthCard } from "./AuthForm";
import styles from "./AuthForm.module.css";

/**
 * One field, and one answer for every email. The answer is fixed here and not
 * read from the route, so no word on this screen can change with the account.
 * Off, the page says who can make a link instead, and draws no field.
 */
export function ForgotForm({ on }: { on: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/forgot", { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Forgot password">
      {!on && <p className={styles.tagline}>{FORGOT_OFF}</p>}

      {on && sent && (
        <p className={styles.tagline} role="status">
          {FORGOT_SENT}
        </p>
      )}

      {on && !sent && (
        <>
          <p className={styles.tagline}>
            Type the email of your account, and we email it a link to set a new password.
          </p>
          <form className={styles.form} onSubmit={submit}>
            <div className={styles.field}>
              <span className="label">Email</span>
              <Input
                size="lg"
                block
                autoFocus
                type="email"
                value={email}
                aria-label="Your email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}

            <Button size="lg" block type="submit" disabled={busy} className={styles.submit}>
              {busy ? "One moment…" : "Email me a link"}
            </Button>
          </form>
        </>
      )}

      <div className={styles.switch}>
        <Link href="/login">Back to sign in</Link>
      </div>
    </AuthCard>
  );
}
