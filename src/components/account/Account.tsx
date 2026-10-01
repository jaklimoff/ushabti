"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { editedText } from "@/lib/leave";
import { Button } from "@/components/ui/Button";
import { ColorSwatches, FaceSwatches, Field, Input } from "@/components/ui/Form";
import { PasswordRow, RevealButton } from "@/components/ui/RevealButton";
import { Card, Note, Row, Section, Spacer } from "@/components/ui/Layout";
import { Toasts, type Toast } from "@/components/ui/Toasts";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { UserMenu, type SessionUser } from "@/components/ui/UserMenu";
import styles from "./account.module.css";

export function Account({
  user,
  version,
  askMailOn,
}: {
  user: SessionUser & { askMail: boolean };
  version: string;
  /** Whether this server emails an unanswered ask at all. */
  askMailOn: boolean;
}) {
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
  const [emoji, setEmoji] = useState(user.emoji);
  /* What this tab last asked the server to wear. A pick is compared with it
     and not with the page's first answer, so a quick pick back to the old
     face is still sent. The saves go out one after another, so the server
     keeps the last pick and not whichever request arrived last. */
  const sentFace = useRef(user.emoji);
  const faceSaves = useRef<Promise<unknown>>(Promise.resolve());
  /* Only the newest pick may put the face back when its save fails, so a
     slow refusal never undoes a face picked after it. */
  const facePick = useRef(0);
  /* The box mirrors a saved name. Only what this tab typed may be written
     back, so another window of yours cannot be undone by closing this one. */
  const [typed, setTyped] = useState(false);

  /* The name saves on blur, and a closed tab sends no blur. The colour is
     picked, not typed, so the pick is its blur and it has nothing to lose. */
  const nameEdit = typed ? editedText(name, user.name) : null;
  useSaveOnLeave(() =>
    nameEdit ? { method: "PATCH", url: "/api/auth/me", body: { name: nameEdit } } : null,
  );

  async function saveProfile(patch: {
    name?: string;
    color?: string;
    emoji?: string | null;
  }): Promise<boolean> {
    try {
      await api.patch("/api/auth/me", patch);
      router.refresh();
      notify("Saved.", "info");
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save.");
      setName(user.name);
      setColor(user.color);
      return false;
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
        <UserMenu user={{ ...user, name, color, emoji }} />
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
                onChange={(e) => {
                  setName(e.target.value);
                  setTyped(true);
                }}
                onBlur={() => {
                  setTyped(false);
                  if (!name.trim()) return setName(user.name);
                  if (nameEdit) void saveProfile({ name: nameEdit });
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
                emoji={emoji}
                value={color}
                onPick={(next) => {
                  setColor(next);
                  if (next !== user.color) void saveProfile({ color: next });
                }}
              />
            </Field>
          </Row>

          <Row className={styles.stack}>
            <Field
              label="Face"
              note="Worn on your colour in place of your initials, so two people with the same initials still look different."
            >
              <FaceSwatches
                name={name || user.name}
                color={color}
                value={emoji}
                onPick={(next) => {
                  const pick = (facePick.current += 1);
                  const before = sentFace.current;
                  setEmoji(next);
                  if (next === before) return;
                  sentFace.current = next;
                  faceSaves.current = faceSaves.current.then(async () => {
                    const saved = await saveProfile({ emoji: next });
                    if (saved || pick !== facePick.current) return;
                    sentFace.current = before;
                    setEmoji(before);
                  });
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

        {askMailOn && <AskMailSection on={user.askMail} notify={notify} />}

        <PasswordSection notify={notify} />

        <span className={styles.version}>Ushabti {version}</span>
      </div>

      <Toasts toasts={toasts} />
    </div>
  );
}

/**
 * The one email an unanswered question from an agent sends. It is a press,
 * so it saves at once, and a press while the save is out is ignored.
 */
function AskMailSection({
  on: saved,
  notify,
}: {
  on: boolean;
  notify: (text: string, kind?: Toast["kind"]) => void;
}) {
  const [on, setOn] = useState(saved);
  const [busy, setBusy] = useState(false);

  async function flip() {
    if (busy) return;
    const next = !on;
    setBusy(true);
    try {
      await api.patch("/api/auth/me", { askMail: next });
      setOn(next);
      notify(next ? "You get these emails again." : "You get no more of these emails.", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Row className={styles.stack}>
        <Field
          label="Questions from agents"
          note={
            on
              ? "When an agent asks you a question and nobody answers it for 15 minutes, you get one email about it."
              : "You get no email when an agent asks you a question. The board still shows it."
          }
        >
          <Button variant="ghost" disabled={busy} onClick={() => void flip()}>
            {on ? "Turn off these emails" : "Turn on these emails"}
          </Button>
        </Field>
      </Row>
    </Card>
  );
}

/**
 * The way back from a password you think has leaked, and still know. Changing
 * it ends every other session. One you cannot remember is a different way
 * back: the owner of a project makes a link.
 */
function PasswordSection({ notify }: { notify: (text: string, kind?: Toast["kind"]) => void }) {
  // Both passwords are read from their boxes, never kept in state, as on the
  // sign-in page: a password manager can write a box with no event React
  // hears, and a controlled box then empties itself on the next render.
  const currentBox = useRef<HTMLInputElement>(null);
  const nextBox = useRef<HTMLInputElement>(null);
  // Each box has its own eye, as the sign-in page has, so one reveal reads
  // one way everywhere.
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  // Which box an error is about, so the sentence sits under that box.
  const [error, setError] = useState<{ on: "current" | "next"; text: string } | null>(null);
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
    const current = currentBox.current?.value ?? "";
    const next = nextBox.current?.value ?? "";
    if (!current) return setError({ on: "current", text: "Type the password you use now." });
    if (next.length < 8) {
      return setError({ on: "next", text: "The new password must have at least 8 characters." });
    }
    setBusy(true);
    try {
      await api.post("/api/auth/password", { current, next });
      if (currentBox.current) currentBox.current.value = "";
      if (nextBox.current) nextBox.current.value = "";
      notify("Password changed. Every other session is signed out.", "info");
      await loadSessions();
    } catch (err) {
      setError({
        on: "next",
        text: err instanceof Error ? err.message : "Could not change the password.",
      });
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
          <Field label="Now" error={error?.on === "current" ? error.text : null}>
            <PasswordRow>
              <Input
                ref={currentBox}
                size="lg"
                block
                type={showCurrent ? "text" : "password"}
                autoComplete="current-password"
                aria-label="The password you use now"
                invalid={error?.on === "current"}
                onChange={() => setError(null)}
              />
              <RevealButton
                shown={showCurrent}
                onToggle={() => setShowCurrent((v) => !v)}
                what="the current password"
              />
            </PasswordRow>
          </Field>
        </Row>
        <Row className={styles.stack}>
          <Field
            label="New"
            error={error?.on === "next" ? error.text : null}
            note="At least 8 characters. Keep it somewhere safe: a password nobody knows needs a link from the owner of your project."
          >
            <PasswordRow>
              <Input
                ref={nextBox}
                size="lg"
                block
                type={showNext ? "text" : "password"}
                autoComplete="new-password"
                aria-label="The password you want"
                minLength={8}
                invalid={error?.on === "next"}
                onChange={() => setError(null)}
                onKeyDown={(e) => e.key === "Enter" && void change()}
              />
              <RevealButton
                shown={showNext}
                onToggle={() => setShowNext((v) => !v)}
                what="the new password"
              />
            </PasswordRow>
          </Field>
        </Row>
        <Row>
          <Spacer />
          {/* Not greyed out while a box looks empty: a box a password manager
              filled looks empty to React, and the button would stay dead. */}
          <Button onClick={() => void change()} disabled={busy}>
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
