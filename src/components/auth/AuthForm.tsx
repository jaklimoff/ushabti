"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError, api } from "@/lib/client";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { OutsideBrand, OutsideFrame, outsideCard } from "@/components/ui/OutsideFrame";
import { PasswordRow, RevealButton } from "@/components/ui/RevealButton";
import styles from "./AuthForm.module.css";

type Mode = "login" | "register";

/** What each box is missing, said on the box itself. */
type Wrong = { name?: string; email?: string; password?: string };

/** The shortest password the server takes. */
export const PASSWORD_MIN = 8;

export const TOO_SHORT = `Use at least ${PASSWORD_MIN} characters.`;

/** The first thing wrong with an email, or nothing. The server has the last word. */
export function emailWrong(email: string): string | undefined {
  if (email.trim() === "") return "Type your email.";
  if (!email.includes("@")) return "Type a whole email, like you@example.com.";
  return undefined;
}

export function AuthForm({
  mode,
  signupOpen = true,
  forgotOn = false,
  invite,
}: {
  mode: Mode;
  signupOpen?: boolean;
  /** Whether this board can email a reset link, which the server alone knows. */
  forgotOn?: boolean;
  /** A live invite link this page was opened from. Its email is the only one it takes. */
  invite?: { token: string; email: string; project: string };
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invite?.email ?? "");
  // The password is read from the box, never kept in state. A password
  // manager can write the box with no event React hears, and a controlled box
  // then empties itself on the next render and sends nothing.
  const passwordBox = useRef<HTMLInputElement>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  const emailBox = useRef<HTMLInputElement>(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState<Wrong>({});
  /* A refused sign-in cannot say which box was wrong without saying whether
     the account exists, so it marks both. */
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);

  const register = mode === "register";

  /** Checked here so the page never shows the browser's own pale bubble. */
  function check(password: string): Wrong {
    const found: Wrong = {};
    if (register && name.trim() === "") found.name = "Type your name.";
    if (!invite) found.email = emailWrong(email);
    if (password === "") found.password = "Type your password.";
    else if (register && password.length < PASSWORD_MIN) found.password = TOO_SHORT;
    return found;
  }

  function fix(field: keyof Wrong) {
    setRefused(false);
    if (wrong[field]) setWrong((w) => ({ ...w, [field]: undefined }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const password = passwordBox.current?.value ?? "";
    const found = check(password);
    setWrong(found);
    setRefused(false);
    setError(null);
    if (found.name || found.email || found.password) {
      (found.name ? nameBox : found.email ? emailBox : passwordBox).current?.focus();
      return;
    }
    setBusy(true);
    try {
      await api.post(register ? "/api/auth/register" : "/api/auth/login", {
        name,
        email,
        password,
        ...(invite ? { invite: invite.token } : {}),
      });
      router.replace("/projects");
      router.refresh();
    } catch (err) {
      const said = err instanceof Error ? err.message : "Something went wrong.";
      const status = err instanceof ApiError ? err.status : 0;
      if (register && status === 409) {
        // The email is taken: that belongs on the email box.
        setWrong({ email: said });
        emailBox.current?.focus();
      } else {
        setRefused(!register && status === 401);
        setError(said);
      }
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={register ? "Create an account" : "Sign in"}
      below={
        register ? (
          <>
            Already have an account? <Link href="/login">Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/register">Create an account</Link>
          </>
        )
      }
    >
      {/* A closed board keeps the form: an invited email still gets in, and
          the server refuses the rest. */}
      {invite && (
        <p className={styles.tagline} data-testid="invite-tagline">
          You are invited to <strong className={styles.project}>{invite.project}</strong>. Create an
          account with {invite.email}, and you are in the project at once.
        </p>
      )}
      {register && !invite && signupOpen && (
        <p className={styles.tagline}>
          You define the fields. The board, the list and the roadmap follow them.
        </p>
      )}
      {register && !invite && !signupOpen && (
        <p className={styles.tagline}>
          This board is closed. It takes a new account only from an invite link, so open the one an
          admin of your project sent you.
        </p>
      )}

      <form className={styles.form} onSubmit={submit} noValidate>
        {register && (
          <Field label="Name" error={wrong.name}>
            <Input
              size="lg"
              block
              autoFocus
              ref={nameBox}
              value={name}
              aria-label="Your name"
              onChange={(e) => {
                setName(e.target.value);
                fix("name");
              }}
              placeholder="Ada Lovelace"
              autoComplete="name"
              required
            />
          </Field>
        )}
        <Field
          label="Email"
          error={wrong.email}
          note={invite ? "The invite is for this email." : undefined}
        >
          <Input
            size="lg"
            block
            autoFocus={!register}
            ref={emailBox}
            type="email"
            value={email}
            readOnly={invite !== undefined}
            invalid={refused}
            aria-label="Your email"
            onChange={(e) => {
              setEmail(e.target.value);
              fix("email");
            }}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </Field>
        <div className={styles.passwordField}>
          <Field
            label="Password"
            error={wrong.password}
            note={register ? passwordNote(forgotOn) : undefined}
          >
            <PasswordRow>
              <Input
                size="lg"
                block
                ref={passwordBox}
                type={show ? "text" : "password"}
                invalid={refused}
                aria-label="Your password"
                onChange={() => fix("password")}
                autoComplete={register ? "new-password" : "current-password"}
                required
              />
              {/*
               * A reveal rather than a second field. A typo here means asking
               * an admin of a project for a way back in, which is a person's
               * afternoon rather than a second field's.
               */}
              <RevealButton shown={show} onToggle={() => setShow((v) => !v)} />
            </PasswordRow>
          </Field>
          {/* Always there, because /forgot says what to do when mail is off.
              It comes after the box in the page, so Tab reaches the password
              first, and sits on the label's line, next to what it is about. */}
          {!register && (
            <Link href="/forgot" className={styles.forgot}>
              Forgot password?
            </Link>
          )}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <Button size="lg" block type="submit" busy={busy}>
          {busy ? "One moment…" : register ? "Create account" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}

function passwordNote(forgotOn: boolean) {
  return forgotOn
    ? `At least ${PASSWORD_MIN} characters. If you forget it, use Forgot password? on the sign-in page.`
    : `At least ${PASSWORD_MIN} characters. If you forget it, an admin of your project can make you a reset link.`;
}

/**
 * The shell every page outside the board shares: the mark, the name, what
 * Ushabti is, and one card. Sign in, sign up, forgot, an invite and a reset
 * link all wear it, so none of them declares this geometry again.
 *
 * The block hangs from a fixed height and grows down, so the brand stays put
 * from page to page and an error never moves what is above it.
 */
export function AuthCard({
  title,
  below,
  children,
}: {
  title?: string;
  /** The one line under the card: the other page, or the way back. */
  below?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <OutsideFrame>
      <OutsideBrand />
      <section className={`${outsideCard} ${styles.card}`}>
        {title && <h1 className={styles.h1}>{title}</h1>}
        {children}
      </section>
      {below && <div className={styles.below}>{below}</div>}
    </OutsideFrame>
  );
}
