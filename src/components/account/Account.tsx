"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { editedText } from "@/lib/leave";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { Checkbox, ColorSwatches, FaceSwatches, Field, Input, Label } from "@/components/ui/Form";
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
  const [others, setOthers] = useState<number | null | undefined>(undefined);
  const loadSessions = useCallback(async () => {
    setOthers(undefined);
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

      <PageShell width="content">
        <PageHead title="Account" lead="How you look to your team, and how you sign in." />

        {/* Everything in Profile saves as it is made; everything under Sign in
            and Personal tokens waits for its button. The two halves of the
            lead are the two save models, so the page groups by them. */}
        <Section title="Profile" note="Saved as you go.">
          <Card>
            {/* The circle and the name as the team sees them, drawn from what
                is on this page now, so every pick below shows here first. */}
            <div className={styles.preview} data-testid="account-preview">
              <Avatar name={shownName} color={color} emoji={emoji} size={44} title={null} />
              <div className={styles.who}>
                <Label aria-hidden="true">How you appear</Label>
                <span className={styles.whoName}>{shownName}</span>
              </div>
            </div>

            <Row>
              <Field label="Name" inline note="Cards, comments and the activity log use this.">
                <Input
                  width="long"
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

            <Row>
              <Field
                label="Colour"
                inline
                note="Your circle on every card. Pick one nobody else on your team uses."
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

            <Row>
              <Field label="Face" inline note="Worn on your colour instead of your initials.">
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

        <Section title="Sign in">
          <PasswordSection email={user.email} onChanged={loadSessions} />
          <SessionsSection others={others} notify={notify} reload={loadSessions} />
        </Section>

        <PersonalTokens notify={notify} />

        {askMailOn && <EmailSection on={user.askMail} notify={notify} />}

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

  // Called Notifications and not Email, so it is not read as the email you
  // sign in with, which sits under Sign in.
  return (
    <Section title="Notifications">
      <Card>
        <Row className={styles.mailRow}>
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
 *
 * It is a real form, so Enter in either box sends it, and the email above the
 * boxes is the username a password manager files the new password under.
 */
function PasswordSection({ email, onChanged }: { email: string; onChanged: () => void }) {
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

  /* The box an error is about takes the focus, so the next key goes where
     the sentence points. */
  function wrong(on: "current" | "next", text: string) {
    setError({ on, text });
    (on === "current" ? currentBox : nextBox).current?.focus();
  }

  async function change() {
    if (busy) return;
    typing();
    const current = currentBox.current?.value ?? "";
    const next = nextBox.current?.value ?? "";
    if (!current) return wrong("current", "Type the password you use now.");
    if (next.length < 8) return wrong("next", "The new password must have at least 8 characters.");
    setBusy(true);
    try {
      await api.post("/api/auth/password", { current, next });
      if (currentBox.current) currentBox.current.value = "";
      if (nextBox.current) nextBox.current.value = "";
      // An eye left open would show the next password typed in clear.
      setShowCurrent(false);
      setShowNext(false);
      setDone(true);
      onChanged();
    } catch (err) {
      // The route answers 403 only when the current password is wrong, so
      // that sentence goes under the box that holds it.
      wrong(
        err instanceof ApiError && err.status === 403 ? "current" : "next",
        err instanceof Error ? err.message : "Could not change the password.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void change();
        }}
      >
        <Row>
          <Field label="Email" inline note="You sign in with this email. It cannot be changed yet.">
            <Input
              className={styles.email}
              width="long"
              readOnly
              aria-label="Your email"
              autoComplete="username"
              value={email}
            />
          </Field>
        </Row>
        <Row>
          <Field
            label="Current password"
            inline
            error={error?.on === "current" ? error.text : null}
          >
            <PasswordRow>
              <Input
                ref={currentBox}
                width="long"
                type={showCurrent ? "text" : "password"}
                autoComplete="current-password"
                aria-label="The password you use now"
                invalid={error?.on === "current"}
                onChange={typing}
              />
              <RevealButton
                size="md"
                shown={showCurrent}
                onToggle={() => setShowCurrent((v) => !v)}
                what="the current password"
              />
            </PasswordRow>
          </Field>
        </Row>
        <Row>
          <Field
            label="New password"
            inline
            error={error?.on === "next" ? error.text : null}
            note="At least 8 characters. Keep it somewhere safe: a password nobody knows needs a link from an admin of your project."
          >
            <PasswordRow>
              <Input
                ref={nextBox}
                width="long"
                type={showNext ? "text" : "password"}
                autoComplete="new-password"
                aria-label="The password you want"
                minLength={8}
                invalid={error?.on === "next"}
                onChange={typing}
              />
              <RevealButton
                size="md"
                shown={showNext}
                onToggle={() => setShowNext((v) => !v)}
                what="the new password"
              />
            </PasswordRow>
          </Field>
        </Row>
        <Foot>
          <span className={done ? styles.done : styles.footSay} role="status">
            {done
              ? "Password changed. Every other session is signed out."
              : "Changing it signs you out everywhere else."}
          </span>
          <Spacer />
          {/* Not greyed out while a box looks empty: a box a password manager
              filled looks empty to React, and the button would stay dead. */}
          <Button type="submit" busy={busy}>
            {busy ? "Changing…" : "Change password"}
          </Button>
        </Foot>
      </form>
    </Card>
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
  /** Undefined until the first count comes back; null when it failed. */
  others: number | null | undefined;
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
          <Field label="Sessions" inline>
            <span className={styles.sessionText} role="status">
              {others === undefined
                ? "Counting your other sessions…"
                : others === null
                  ? "Other sessions could not be counted."
                  : others === 0
                    ? "You are signed in here only."
                    : `You are signed in here and in ${sessions(others)}.`}
            </span>
            <Spacer />
            {/* A failed count is asked again; a button that cannot be pressed
                left no way forward. */}
            {others === null ? (
              <Button variant="text" onClick={() => void reload()}>
                Try again
              </Button>
            ) : (
              <Button variant="ghost" disabled={!others} onClick={confirm.ask}>
                Sign out the others
              </Button>
            )}
          </Field>
        </Row>
      )}
    </Card>
  );
}
