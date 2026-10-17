"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { PersonalTokenDTO } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { CopyField } from "@/components/ui/CopyField";
import { Field, Input, Select } from "@/components/ui/Form";
import { Card, Note, Row, Section, Spacer } from "@/components/ui/Layout";
import type { Toast } from "@/components/ui/Toasts";
import styles from "./account.module.css";

const EXPIRIES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];

/* Named month and a fixed locale: the list is the same in every browser. */
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function day(iso: string): string {
  return DAY.format(new Date(iso));
}

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
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ id: string; secret: string } | null>(null);

  const load = useCallback(async () => {
    const res = await api.get<{ tokens: PersonalTokenDTO[] }>("/api/auth/tokens");
    setTokens(res.tokens);
  }, []);

  useEffect(() => {
    let alive = true;
    void api
      .get<{ tokens: PersonalTokenDTO[] }>("/api/auth/tokens")
      .then((res) => alive && setTokens(res.tokens))
      .catch(() => alive && setTokens([]));
    return () => {
      alive = false;
    };
  }, []);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ token: PersonalTokenDTO; secret: string }>("/api/auth/tokens", {
        name: trimmed,
        days: expiry === "never" ? null : Number(expiry),
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
    <Section
      title="Personal tokens"
      note="A script or an agent with one acts as you, on every project you are in."
    >
      <Card>
        <Row className={styles.stack}>
          <Field
            label="New token"
            note="Everything it does is signed with your name. It cannot add people, agents or tokens."
          >
            <div className={styles.tokenMake}>
              <Input
                aria-label="Token name"
                placeholder="What it is for"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void create()}
              />
              <Select
                aria-label="Expires after"
                value={expiry}
                onChange={setExpiry}
                options={EXPIRIES}
              />
              <Button onClick={() => void create()} disabled={busy || !name.trim()}>
                {busy ? "Making…" : "Make token"}
              </Button>
            </div>
          </Field>
        </Row>
        {made && (
          <Row className={styles.stack} data-testid="personal-secret">
            <Field
              label="Your new token"
              note="Copy it now. It is not shown again; a lost one is revoked and made anew."
            >
              <CopyField value={made.secret} label="the token" loud />
            </Field>
          </Row>
        )}
        {tokens?.map((token) => (
          <TokenRow key={token.id} token={token} onRevoke={() => void revoke(token)} />
        ))}
        {tokens?.length === 0 && (
          <Row>
            <Note>You have no personal tokens.</Note>
          </Row>
        )}
      </Card>
    </Section>
  );
}

function TokenRow({ token, onRevoke }: { token: PersonalTokenDTO; onRevoke: () => void }) {
  const confirm = useConfirm();

  if (confirm.asking) {
    return (
      <ConfirmRow
        question={`Revoke the token “${token.name}”? Whatever uses it stops working within one request.`}
        confirmLabel="Yes, revoke"
        onConfirm={() => confirm.confirm(onRevoke)}
        onCancel={confirm.cancel}
      />
    );
  }

  return (
    <Row data-testid="personal-token-row">
      <span className={styles.tokenName}>{token.name}</span>
      <span className={styles.tokenPrefix}>{token.prefix}…</span>
      <Note>
        made {day(token.createdAt)} ·{" "}
        {token.expiresAt ? `expires ${day(token.expiresAt)}` : "never expires"} ·{" "}
        {token.lastUsedAt ? `last used ${day(token.lastUsedAt)}` : "never used"}
      </Note>
      <Spacer />
      <IconButton
        danger
        label={`Revoke the token ${token.name}`}
        title="Revoke this token"
        onClick={confirm.ask}
      >
        ✕
      </IconButton>
    </Row>
  );
}
