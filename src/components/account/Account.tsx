"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { editedText } from "@/lib/leave";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { Checkbox, ColorSwatches, FaceSwatches, Field, Input } from "@/components/ui/Form";
import { PasswordRow, RevealButton } from "@/components/ui/RevealButton";
import { Card, Foot, PageHead, PageShell, Row, Section, Spacer } from "@/components/ui/Layout";
import { Toasts, type Toast } from "@/components/ui/Toasts";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import type { SessionUser } from "@/components/ui/UserMenu";
import { AppBar, AppCrumb } from "@/components/ui/AppBar";
import styles from "./account.module.css";
import { PersonalTokens } from "./PersonalTokens";

type Notify = (text: string, kind?: Toast["kind"]) => void;

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

  // A toast is for what failed. A save that worked shows itself: the
  // preview, the bar and the box already wear the new value.
  const notify = useCallback<Notify>((text, kind = "error") => {
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

  /* Counted here, not in the sessions card, because a password change ends
     the other sessions too and the card has to say so. */
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

  async function saveProfile(patch: {
    name?: string;
    color?: string;
    emoji?: string | null;
  }): Promise<boolean> {
    try {
      await api.patch("/api/auth/me", patch);
      router.refresh();
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save.");
      setName(user.name);
      setColor(user.color);
      return false;
    }
  }

  const shownName = name.trim() || user.name;

  return (
    <div className={styles.page}>
      <AppBar
        user={{ ...user, name, color, emoji }}
        trail={[<AppCrumb key="here">Account</AppCrumb>]}
      />

      <PageShell width="narrow">
        <PageHead title="Account" lead="How you look to your team, and how you sign in." />

        <Section title="Profile">
          <Card>
            {/* The circle and the name as the team sees them, drawn from what
                is on this page now, so every pick below shows here first. */}
            <div className={styles.preview} data-testid="account-preview">
              <Avatar name={shownName} color={color} emoji={emoji} size={40} title={null} />
              <div className={styles.who}>
                <span className={styles.whoName}>{shownName}</span>
                <span className={styles.whoMail}>{user.email}</span>
                <span className={styles.whoAside}>
                  You sign in with this email. It cannot be changed yet.
                </span>
              </div>
              <span className={styles.previewLabel} aria-hidden="true">
                How you appear
              </span>
            </div>

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
                  name={shownName}
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
                  name={shownName}
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
          </Card>
        </Section>

        {askMailOn && <EmailSection on={user.askMail} notify={notify} />}

        <PasswordSection onChanged={loadSessions} />

        <SessionsSection others={others} notify={notify} reload={loadSessions} />

        <PersonalTokens notify={notify} />

        <span className={styles.version}>Ushabti {version}</span>
      </PageShell>

      <Toasts toasts={toasts} />
    </div>
  );
}

/**
 * The one email an unanswered question from an agent sends. A tick saves at
 * once, and a tick while the save is out is ignored. The box shows the new
 * state straight away and goes back if the save fails.
 */
function EmailSection({ on: saved, notify }: { on: boolean; notify: Notify }) {
  const [on, setOn] = useState(saved);
  const [busy, setBusy] = useState(false);

  async function flip() {
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      await api.patch("/api/auth/me", { askMail: next });
    } catch (err) {
      setOn(!next);
      notify(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Email">
      <Card>
        <Row className={`${styles.stack} ${styles.mailRow}`}>
          <Checkbox
            className={styles.mailCheck}
            label="Email me when an agent asks me something and nobody answers for 15 minutes"
            checked={on}
            onChange={() => void flip()}
          />
          <span className={styles.rowNote}>
            {on
              ? "One email per question. The board shows the question either way."
              : "You get no email. The board still shows every question."}
          </span>
        </Row>
      </Card>
    </Section>
  );
}

/**
 * The way back from a password you think has leaked, and still know. Changing
 * it ends every other session. One you cannot remember is a different way
 * back: an admin of a project makes a link.
 */
function PasswordSection({ onChanged }: { onChanged: () => void }) {
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
  const [done, setDone] = useState(false);

  function typing() {
    setError(null);
    setDone(false);
  }

  async function change() {
    if (busy) return;
    typing();
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
      setDone(true);
      onChanged();
    } catch (err) {
      // The route answers 403 only when the current password is wrong, so
      // that sentence goes under the box that holds it.
      setError({
        on: err instanceof ApiError && err.status === 403 ? "current" : "next",
        text: err instanceof Error ? err.message : "Could not change the password.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Password">
      <Card>
        <Row className={styles.stack}>
          <Field label="Current password" error={error?.on === "current" ? error.text : null}>
            <PasswordRow>
              <Input
                ref={currentBox}
                size="lg"
                block
                type={showCurrent ? "text" : "password"}
                autoComplete="current-password"
                aria-label="The password you use now"
                invalid={error?.on === "current"}
                onChange={typing}
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
            label="New password"
            error={error?.on === "next" ? error.text : null}
            note="At least 8 characters. Keep it somewhere safe: a password nobody knows needs a link from an admin of your project."
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
                onChange={typing}
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
        <Foot>
          <span className={done ? styles.done : styles.footNote} role="status">
            {done
              ? "Password changed. Every other session is signed out."
              : "Changing it signs you out everywhere else."}
          </span>
          <Spacer />
          {/* Not greyed out while a box looks empty: a box a password manager
              filled looks empty to React, and the button would stay dead. */}
          <Button size="lg" onClick={() => void change()} busy={busy}>
            {busy ? "Changing…" : "Change password"}
          </Button>
        </Foot>
      </Card>
    </Section>
  );
}

function sessions(count: number): string {
  return `${count} other ${count === 1 ? "session" : "sessions"}`;
}

/**
 * The other browsers signed in as you. Ending them is one press that cannot
 * be taken back, so the row asks first and names how many go.
 */
function SessionsSection({
  others,
  notify,
  reload,
}: {
  others: number | null;
  notify: Notify;
  reload: () => Promise<void>;
}) {
  const confirm = useConfirm();

  async function signOutOthers() {
    try {
      await api.del("/api/auth/sessions");
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not sign the other sessions out.");
    }
  }

  return (
    <Section title="Sessions">
      <Card>
        {confirm.asking && others ? (
          <ConfirmRow
            question={`Sign out ${sessions(others)}? This one stays.`}
            confirmLabel="Yes, sign them out"
            onConfirm={() => confirm.confirm(() => void signOutOthers())}
            onCancel={confirm.cancel}
          />
        ) : (
          <Row>
            <span className={styles.sessionText}>
              {others === null
                ? "Other sessions could not be counted."
                : others === 0
                  ? "You are signed in here only."
                  : `You are signed in here and in ${sessions(others)}.`}
            </span>
            <Spacer />
            <Button variant="ghost" disabled={!others} onClick={confirm.ask}>
              Sign out the others
            </Button>
          </Row>
        )}
      </Card>
    </Section>
  );
}
