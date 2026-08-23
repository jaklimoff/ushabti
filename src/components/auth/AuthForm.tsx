"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import styles from "./AuthForm.module.css";

type Mode = "login" | "register";

export function AuthForm({ mode, signupOpen = true }: { mode: Mode; signupOpen?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        password,
      });
      router.replace("/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  if (register && !signupOpen) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <Brand />
          <h1 className={styles.h1}>This board is closed</h1>
          <p className={styles.tagline}>
            It is not taking new accounts. Ask whoever runs it to make one for you.
          </p>
          <div className={styles.switch}>
            Already have an account? <Link href="/login">Sign in</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <Brand />
        <h1 className={styles.h1}>{register ? "Create an account" : "Sign in"}</h1>
        {/* The pitch belongs where somebody is deciding, not where they sign
            in every morning. */}
        {register && (
          <p className={styles.tagline}>
            A small, fast task board. You define the properties; the board follows them.
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
            <div className={styles.passwordRow}>
              <Input
                size="lg"
                block
                type={show ? "text" : "password"}
                value={password}
                aria-label="Your password"
                minLength={register ? 8 : undefined}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={register ? "At least 8 characters" : "Your password"}
                autoComplete={register ? "new-password" : "current-password"}
                required
              />
              {/*
               * A reveal rather than a second field. There is no password
               * reset, so a typo here locks the account for good.
               */}
              <button
                type="button"
                className={styles.reveal}
                aria-pressed={show}
                aria-label={show ? "Hide the password" : "Show the password"}
                onClick={() => setShow((v) => !v)}
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
            {register && (
              <span className={styles.hint}>
                At least 8 characters. There is no password reset yet — keep it somewhere safe.
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
