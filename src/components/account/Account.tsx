"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/Button";
import { ColorSwatches, Field, Input } from "@/components/ui/Form";
import { Card, Note, Row, Section, Spacer } from "@/components/ui/Layout";
import { Toasts, type Toast } from "@/components/ui/Toasts";
import { UserMenu, type SessionUser } from "@/components/ui/UserMenu";
import styles from "./account.module.css";

export function Account({ user, version }: { user: SessionUser; version: string }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const notify = useCallback((text: string, kind: Toast["kind"] = "error") => {
    const id = (seq.current += 1);
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 5200);
  }, []);

  const [name, setName] = useState(user.name);
  const [color, setColor] = useState(user.color);

  async function saveProfile(patch: { name?: string; color?: string }) {
    try {
      await api.patch("/api/auth/me", patch);
      router.refresh();
      notify("Saved.", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save.");
      setName(user.name);
      setColor(user.color);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <div className={styles.mark}>U</div>
        <Link href="/projects" className={styles.brand}>
          Ushabti
        </Link>
        <span style={{ flex: 1 }} />
        <UserMenu user={{ ...user, name, color }} />
      </div>

      <div className={styles.body}>
        <h1 className={styles.h1}>Account</h1>

        <Card>
          <Row className={styles.stack}>
            <Field label="Name" note="Cards, comments and the activity log use this.">
              <Input
                size="lg"
                block
                aria-label="Your name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  const trimmed = name.trim();
                  if (!trimmed) return setName(user.name);
                  if (trimmed !== user.name) void saveProfile({ name: trimmed });
                }}
              />
            </Field>
          </Row>

          <Row className={styles.stack}>
            <Field
              label="Colour"
              note="Your circle on every card. Pick one nobody else on your team is using."
            >
              <ColorSwatches
                name={name || user.name}
                value={color}
                onPick={(next) => {
                  setColor(next);
                  if (next !== user.color) void saveProfile({ color: next });
                }}
              />
            </Field>
          </Row>

          <Row className={styles.stack}>
            <Field label="Email" note="You sign in with this. It cannot be changed yet.">
              <span className={styles.readonly}>{user.email}</span>
            </Field>
          </Row>
        </Card>

        <PasswordSection notify={notify} />

        <span className={styles.version}>Ushabti {version}</span>
      </div>

      <Toasts toasts={toasts} />
    </div>
  );
}

/**
 * There is no password reset, so this is the only way back from one you think
 * has leaked. Changing it ends every other session.
 */
function PasswordSection({ notify }: { notify: (text: string, kind?: Toast["kind"]) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [others, setOthers] = useState<number | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.get<{ others: number }>("/api/auth/sessions");
      setOthers(res.others);
    } catch {
      setOthers(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void api
      .get<{ others: number }>("/api/auth/sessions")
      .then((res) => alive && setOthers(res.others))
      .catch(() => alive && setOthers(null));
    return () => {
      alive = false;
    };
  }, []);

  async function change() {
    if (busy) return;
    setError(null);
    if (next.length < 8) return setError("The new password must have at least 8 characters.");
    setBusy(true);
    try {
      await api.post("/api/auth/password", { current, next });
      setCurrent("");
      setNext("");
      notify("Password changed. Every other session is signed out.", "info");
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  async function signOutOthers() {
    try {
      await api.del("/api/auth/sessions");
      notify("Signed out everywhere else.", "info");
      await loadSessions();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not sign the other sessions out.");
    }
  }

  return (
    <Section title="Password">
      <Card>
        <Row className={styles.stack}>
          <Field label="Now">
            <Input
              size="lg"
              block
              type={show ? "text" : "password"}
              autoComplete="current-password"
              aria-label="The password you use now"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
        </Row>
        <Row className={styles.stack}>
          <Field
            label="New"
            error={error}
            note="At least 8 characters. There is no password reset — keep it somewhere safe."
          >
            <Input
              size="lg"
              block
              type={show ? "text" : "password"}
              autoComplete="new-password"
              aria-label="The password you want"
              minLength={8}
              invalid={error !== null}
              value={next}
              onChange={(e) => {
                setNext(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && void change()}
            />
          </Field>
        </Row>
        <Row>
          <button
            type="button"
            className={styles.reveal}
            aria-pressed={show}
            onClick={() => setShow((v) => !v)}
          >
            {show ? "Hide" : "Show"} the passwords
          </button>
          <Spacer />
          <Button onClick={() => void change()} disabled={busy || !current || !next}>
            {busy ? "Changing…" : "Change password"}
          </Button>
        </Row>
        <Row>
          <Note>
            {others === null
              ? "Other sessions could not be counted."
              : others === 0
                ? "No other session is signed in."
                : `${others} other ${others === 1 ? "session is" : "sessions are"} signed in.`}
          </Note>
          <Spacer />
          <Button variant="ghost" disabled={!others} onClick={() => void signOutOthers()}>
            Sign out everywhere
          </Button>
        </Row>
      </Card>
    </Section>
  );
}
