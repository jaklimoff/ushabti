"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client";
import { tokenAgo, tokenExpiry } from "@/lib/token-dates";
import type { PersonalTokenDTO } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";
import { Field, Input, Label, Select } from "@/components/ui/Form";
import { Card, EmptyState, Foot, FootNote, Note, Section } from "@/components/ui/Layout";
import type { Toast } from "@/components/ui/Toasts";
import { TokenRow } from "@/components/ui/TokenRow";
import styles from "./account.module.css";

const EXPIRIES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];

/**
 * Tokens a script uses to act as you. The secret is shown once, right after
 * it is made, and only its digest is kept.
 */
export function PersonalTokens({
  notify,
}: {
  notify: (text: string, kind?: Toast["kind"]) => void;
}) {
  const [tokens, setTokens] = useState<PersonalTokenDTO[] | null>(null);
  /* When the list was read, so every row of one answer counts from the same
     moment and a render never reads the clock. */
  const [now, setNow] = useState(0);
  const [name, setName] = useState("");
  const [expiresIn, setExpiresIn] = useState("90");
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  const [made, setMade] = useState<{ id: string; secret: string } | null>(null);

  const load = useCallback(async () => {
    const res = await api.get<{ tokens: PersonalTokenDTO[] }>("/api/auth/tokens");
    setTokens(res.tokens);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    let alive = true;
    void api
      .get<{ tokens: PersonalTokenDTO[] }>("/api/auth/tokens")
      .then((res) => {
        if (!alive) return;
        setTokens(res.tokens);
        setNow(Date.now());
      })
      .catch(() => alive && setTokens([]));
    return () => {
      alive = false;
    };
  }, []);

  async function create() {
    if (busy) return;
    const trimmed = name.trim();
    /* The button is never dead while the box is empty: a press says what is
       missing, under the box, and puts the cursor there. */
    if (!trimmed) {
      setNameError("Name the token, so you know what to revoke later.");
      nameBox.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ token: PersonalTokenDTO; secret: string }>("/api/auth/tokens", {
        name: trimmed,
        days: expiresIn === "never" ? null : Number(expiresIn),
      });
      setName("");
      setMade({ id: res.token.id, secret: res.secret });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not make the token.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: PersonalTokenDTO) {
    try {
      await api.del(`/api/auth/tokens/${token.id}`);
      if (made?.id === token.id) setMade(null);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not revoke the token.");
    }
  }

  return (
    <Section title="Personal tokens">
      <Card>
        {tokens && tokens.length > 0 && (
          <div className={styles.tokens}>
            {tokens.map((token) => (
              <PersonalTokenRow
                key={token.id}
                token={token}
                now={now}
                secret={made?.id === token.id ? made.secret : undefined}
                onRevoke={() => void revoke(token)}
              />
            ))}
          </div>
        )}
        {tokens?.length === 0 && (
          <EmptyState title="No personal tokens yet.">
            Make one below for a script or an agent that should act as you.
          </EmptyState>
        )}
        <Foot>
          <form
            className={styles.tokenForm}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className={styles.tokenName}>
              <Field label="Token name" error={nameError}>
                <Input
                  ref={nameBox}
                  block
                  aria-label="Token name"
                  placeholder="e.g. CI release script"
                  value={name}
                  maxLength={80}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError(null);
                  }}
                />
              </Field>
            </div>
            <Field label="Expires after">
              <Select
                aria-label="Expires after"
                value={expiresIn}
                onChange={setExpiresIn}
                options={EXPIRIES}
              />
            </Field>
            {/* An empty label above the button, so it sits on the line of the
                boxes and not on the line of their labels. */}
            <div className={styles.tokenGo}>
              <Label aria-hidden="true">&nbsp;</Label>
              <Button type="submit" busy={busy}>
                {busy ? "Making…" : "Make token"}
              </Button>
            </div>
          </form>
          <FootNote>
            <Note>
              A script or an agent with a token acts as you, on every project you are in. Everything
              it does is signed with your name. It cannot add people, agents or tokens.
            </Note>
          </FootNote>
        </Foot>
      </Card>
    </Section>
  );
}

function PersonalTokenRow({
  token,
  now,
  secret,
  onRevoke,
}: {
  token: PersonalTokenDTO;
  now: number;
  /** Only on the row just made, and only until the page is left. */
  secret?: string;
  onRevoke: () => void;
}) {
  const shown = useRef<HTMLDivElement>(null);

  /* A keyboard lands on Copy, the one thing to do next. */
  useEffect(() => {
    if (secret) shown.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [secret]);

  const ends = tokenExpiry(token.expiresAt, now);
  // The board knows its own address, so the recipe says it. Read through a
  // store so the server render stays empty, as Connect in Settings does.
  const origin = useSyncExternalStore(
    subscribeNothing,
    () => window.location.origin,
    () => "",
  );

  return (
    <TokenRow
      name={token.name}
      prefix={token.prefix}
      testId="personal-token-row"
      fresh={Boolean(secret)}
      question={`Revoke the token “${token.name}”? Whatever uses it stops working within one request.`}
      onRevoke={onRevoke}
      meta={
        <>
          made {tokenAgo(token.createdAt, now)} ·{" "}
          <span className={ends.soon ? styles.tokenSoon : undefined}>{ends.text}</span> ·{" "}
          {token.lastUsedAt ? `last used ${tokenAgo(token.lastUsedAt, now)}` : "never used"}
        </>
      }
    >
      {secret && (
        <div ref={shown} className={styles.secret} data-testid="personal-secret">
          <CopyField value={secret} label="the token" loud />
          <Label className={styles.secretHead}>Use it</Label>
          <CopyField
            value={`export USHABTI_URL=${origin}\nexport USHABTI_TOKEN=${secret}`}
            label="the environment"
          />
          <span className={styles.secretSay}>
            Or send it in a header: <code>Authorization: Bearer {"<token>"}</code>
          </span>
          <span className={styles.secretNote}>
            Copy it now. It is not shown again; a lost one is revoked and made anew.
          </span>
        </div>
      )}
    </TokenRow>
  );
}

/** window.location never changes under us, so there is nothing to subscribe to. */
function subscribeNothing() {
  return () => {};
}
