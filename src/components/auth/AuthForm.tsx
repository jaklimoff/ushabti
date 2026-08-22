"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import styles from "./AuthForm.module.css";

type Mode = "login" | "register";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.mark}>U</div>
          <div className={styles.name}>Ushabti</div>
        </div>
        <div className={styles.tagline}>
          A small, fast task board. You define the properties; the board follows them.
        </div>

        <form className={styles.form} onSubmit={submit}>
          {register && (
            <div className={styles.field}>
              <span className="label">Name</span>
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
                required
              />
            </div>
          )}
          <div className={styles.field}>
            <span className="label">Email</span>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className={styles.field}>
            <span className="label">Password</span>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={register ? "At least 8 characters" : "Your password"}
              autoComplete={register ? "new-password" : "current-password"}
              required
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? "One moment…" : register ? "Create account" : "Sign in"}
          </button>
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
