"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { PasswordRow, RevealButton } from "@/components/ui/RevealButton";
import { AuthCard, PASSWORD_MIN, TOO_SHORT } from "./AuthForm";
import styles from "./AuthForm.module.css";

/**
 * One field, because the person holding this link has one thing to say. The
 * link is the proof: an admin of a project they are in made it, or it reached
 * the account's own email. It works once, and using it ends every other
 * session of the account.
 */
export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  // Read from the box and not from state, for the reason `AuthForm` gives.
  const passwordBox = useRef<HTMLInputElement>(null);
  const [show, setShow] = useState(false);
  const [wrong, setWrong] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const password = passwordBox.current?.value ?? "";
    const found =
      password === ""
        ? "Type a new password."
        : password.length < PASSWORD_MIN
          ? TOO_SHORT
          : undefined;
    setWrong(found);
    setError(null);
    if (found) {
      passwordBox.current?.focus();
      return;
    }
    setBusy(true);
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
    <AuthCard title="Set a new password" below={<Link href="/login">Back to sign in</Link>}>
      <p className={styles.tagline}>
        This link sets a new password for your account. Using it signs you out everywhere else.
      </p>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="New password" error={wrong} note={`At least ${PASSWORD_MIN} characters.`}>
          <PasswordRow>
            <Input
              size="xl"
              block
              autoFocus
              ref={passwordBox}
              type={show ? "text" : "password"}
              aria-label="Your new password"
              invalid={error !== null}
              onChange={() => {
                setError(null);
                setWrong(undefined);
              }}
              autoComplete="new-password"
              required
            />
            {/* The same reveal as sign-up, and for the same reason: nobody is
                typing this one twice. */}
            <RevealButton size="xl" shown={show} onToggle={() => setShow((v) => !v)} />
          </PasswordRow>
        </Field>

        <Button size="xl" block type="submit" busy={busy}>
          {busy ? "One moment…" : "Set the password"}
        </Button>
      </form>
    </AuthCard>
  );
}
