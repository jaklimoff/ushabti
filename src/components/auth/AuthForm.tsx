"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { PasswordRow, RevealButton } from "@/components/ui/RevealButton";
import styles from "./AuthForm.module.css";

type Mode = "login" | "register";

export function AuthForm({ mode, signupOpen = true }: { mode: Mode; signupOpen?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // The password is read from the box, never kept in state. A password
  // manager can write the box with no event React hears, and a controlled box
  // then empties itself on the next render and sends nothing.
  const passwordBox = useRef<HTMLInputElement>(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const register = mode === "register";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(register ? "/api/auth/register" : "/api/auth/login", {
        name,
        email,
        password: passwordBox.current?.value ?? "",
      });
      router.replace("/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <AuthCard title={register ? "Create an account" : "Sign in"}>
      {/* The pitch belongs where somebody is deciding, not where they sign in
          every morning. A closed board keeps the form: an invited email still
          gets in, and the server refuses the rest. */}
      {register && signupOpen && (
        <p className={styles.tagline}>
          A small, fast task board. You define the properties; the board follows them.
        </p>
      )}
      {register && !signupOpen && (
        <p className={styles.tagline}>
          This board is closed. It takes a new account only for an email its owner invited, so sign
          up with that one.
        </p>
      )}

      <form className={styles.form} onSubmit={submit}>
        {register && (
          <div className={styles.field}>
            <span className="label">Name</span>
            <Input
              size="lg"
              block
              autoFocus
              value={name}
              aria-label="Your name"
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              autoComplete="name"
              required
            />
          </div>
        )}
        <div className={styles.field}>
          <span className="label">Email</span>
          <Input
            size="lg"
            block
            autoFocus={!register}
            type="email"
            value={email}
            aria-label="Your email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>
        <div className={styles.field}>
          <span className="label">Password</span>
          <PasswordRow>
            <Input
              size="lg"
              block
              ref={passwordBox}
              type={show ? "text" : "password"}
              aria-label="Your password"
              minLength={register ? 8 : undefined}
              placeholder={register ? "At least 8 characters" : "Your password"}
              autoComplete={register ? "new-password" : "current-password"}
              required
            />
            {/*
             * A reveal rather than a second field. A typo here means asking
             * the owner of a project for a way back in, which is a person's
             * afternoon rather than a second field's.
             */}
            <RevealButton shown={show} onToggle={() => setShow((v) => !v)} />
          </PasswordRow>
          {register && (
            <span className={styles.hint}>
              At least 8 characters. Keep it somewhere safe: if you forget it, the owner of a
              project you are in has to make you a way back.
            </span>
          )}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <Button size="lg" block type="submit" disabled={busy} className={styles.submit}>
          {busy ? "One moment…" : register ? "Create account" : "Sign in"}
        </Button>
      </form>

      <div className={styles.switch}>
        {register ? (
          <>
            Already have an account? <Link href="/login">Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/register">Create an account</Link>
          </>
        )}
      </div>
    </AuthCard>
  );
}

/**
 * The shell every page outside the board shares: the mark, the name, and one
 * narrow card. Sign in, sign up and a reset link all wear it, so none of them
 * declares this geometry again.
 */
export function AuthCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <Brand />
        {title && <h1 className={styles.h1}>{title}</h1>}
        {children}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className={styles.brand}>
      <div className={styles.mark}>U</div>
      <div className={styles.name}>Ushabti</div>
    </div>
  );
}
