"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { AuthCard, RevealButton } from "./AuthForm";
import styles from "./AuthForm.module.css";

/**
 * One field, because the person holding this link has one thing to say. The
 * link is the proof: it was made by the owner of a project they are in, it
 * works once, and using it ends every other session of the account.
 */
export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/reset", { token, password });
      router.replace("/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Set a new password">
      <p className={styles.tagline}>
        The owner of your project made this link. Using it signs you out everywhere else.
      </p>

      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <span className="label">New password</span>
          <div className={styles.passwordRow}>
            <Input
              size="lg"
              block
              autoFocus
              type={show ? "text" : "password"}
              value={password}
              aria-label="Your new password"
              minLength={8}
              invalid={error !== null}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
            />
            {/* The same reveal as sign-up, and for the same reason: nobody is
                typing this one twice. */}
            <RevealButton shown={show} onToggle={() => setShow((v) => !v)} />
          </div>
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <Button size="lg" block type="submit" disabled={busy} className={styles.submit}>
          {busy ? "One moment…" : "Set the password"}
        </Button>
      </form>
    </AuthCard>
  );
}
