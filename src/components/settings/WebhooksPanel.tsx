"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { canManage } from "@/lib/roles";
import { editedText } from "@/lib/leave";
import { useBoard } from "@/components/board/store";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { CopyField } from "@/components/ui/CopyField";
import { Input } from "@/components/ui/Form";
import { Card, EmptyState, Foot, Note, Row, Section, Spacer, Tag } from "@/components/ui/Layout";
import { useElapsed } from "@/components/ui/useElapsed";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { WEBHOOK_KIND_LABEL, WEBHOOK_KINDS, type WebhookDTO, type WebhookKind } from "@/lib/types";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

/**
 * The webhooks of a project.
 *
 * Everything here is the owner's: a URL and a secret are another road onto
 * the board, so the route that reads the list is `ownerOnly` as well as the
 * ones that write it. A member sees the sentence and nothing else.
 */
export function WebhooksPanel() {
  const { data } = useBoard();
  const projectId = data.project.id;
  const canEdit = canManage(data.project.role);
  const [hooks, setHooks] = useState<WebhookDTO[] | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await api.get<{ webhooks: WebhookDTO[] }>(`/api/projects/${projectId}/webhooks`);
      setHooks(res.webhooks);
    } catch {
      setHooks([]);
    }
  }, [projectId]);

  useEffect(() => {
    if (!canEdit) return;
    let alive = true;
    void api
      .get<{ webhooks: WebhookDTO[] }>(`/api/projects/${projectId}/webhooks`)
      .then((res) => alive && setHooks(res.webhooks))
      .catch(() => alive && setHooks([]));
    return () => {
      alive = false;
    };
  }, [projectId, canEdit]);

  /* A delivery that is waiting is about to move, and the sender is a second
     away. Ask again while one is, and stop the moment none is. */
  const waiting = (hooks ?? []).some((h) => h.lastDelivery?.state === "waiting");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  return (
    <>
      <PageHead
        title="Webhooks"
        note="A call out of the board, for a service that cannot hold a socket open. It says that something changed and where; the receiver reads the board for the rest."
      />
      {canEdit ? (
        <Hooks hooks={hooks} reload={reload} projectId={projectId} />
      ) : (
        <Section title="Webhooks">
          <Card>
            <Row>
              <Note>Only the owner or an admin can see its webhooks.</Note>
            </Row>
          </Card>
        </Section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function Hooks({
  hooks,
  reload,
  projectId,
}: {
  hooks: WebhookDTO[] | null;
  reload: () => Promise<void>;
  projectId: string;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  /* Why the last URL was refused. It is a sentence in the row rather than a
     toast: a refused address has to stay on screen beside the box that holds
     it, because the next thing the person does is edit that box. */
  const [error, setError] = useState<string | null>(null);
  /** The plain secrets, held until the person leaves the page. */
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  async function add() {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ webhook: WebhookDTO; secret: string }>(
        `/api/projects/${projectId}/webhooks`,
        { url: trimmed, kinds: [] },
      );
      setSecrets((current) => ({ ...current, [res.webhook.id]: res.secret }));
      setUrl("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the webhook.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Endpoints">
      <Card>
        {hooks === null && (
          <Row>
            <Note>Loading…</Note>
          </Row>
        )}

        {hooks !== null && hooks.length === 0 && (
          <EmptyState title="No webhooks yet.">
            Give a URL and this board will post to it whenever something changes. The body says what
            kind of change it was and which task, never the change itself — so the receiver reads
            the activity feed, exactly as an agent on the stream does.
          </EmptyState>
        )}

        {(hooks ?? []).map((hook) => (
          <HookBox
            key={hook.id}
            hook={hook}
            projectId={projectId}
            secret={secrets[hook.id]}
            forget={() =>
              setSecrets((current) => {
                const next = { ...current };
                delete next[hook.id];
                return next;
              })
            }
            show={(secret) => setSecrets((current) => ({ ...current, [hook.id]: secret }))}
            reload={reload}
          />
        ))}

        <Foot>
          <Input
            style={{ flex: 1, minWidth: 180 }}
            aria-label="URL of the new webhook"
            value={url}
            invalid={error !== null}
            placeholder="https://example.com/ushabti"
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void add()}
          />
          <Button onClick={() => void add()} disabled={busy}>
            Add webhook
          </Button>
          {error ? (
            <span className={styles.hookError} role="alert" data-testid="webhook-error">
              {error}
            </span>
          ) : (
            <span style={{ width: "100%" }}>
              <Note>
                The secret is made here and shown once. Keep it: it is what signs every body, and
                the only way to another one is to roll it. The address has to be one a stranger
                could reach too — a private or loopback address is refused.
              </Note>
            </span>
          )}
        </Foot>
      </Card>
    </Section>
  );
}

function HookBox({
  hook,
  projectId,
  secret,
  forget,
  show,
  reload,
}: {
  hook: WebhookDTO;
  projectId: string;
  secret: string | undefined;
  forget: () => void;
  show: (secret: string) => void;
  reload: () => Promise<void>;
}) {
  const { notify } = useBoard();
  const confirm = useConfirm();
  const roll = useConfirm();
  const [url, setUrl] = useState(hook.url);
  /* The box mirrors what is saved, and the mirror goes stale when somebody
     else changes it. Only what this tab typed may be written back. */
  const [typed, setTyped] = useState(false);
  /* Why the last save was refused, said in the row itself. */
  const [error, setError] = useState<string | null>(null);
  /* How many deliveries the delete takes. Null while the server is counting. */
  const [deliveries, setDeliveries] = useState<number | null>(null);
  const base = `/api/projects/${projectId}/webhooks/${hook.id}`;

  /* The address saves on blur, and a closed tab sends no blur. */
  const urlEdit = typed ? editedText(url, hook.url) : null;
  useSaveOnLeave(() => (urlEdit ? { method: "PATCH", url: base, body: { url: urlEdit } } : null));

  async function save(patch: Record<string, unknown>) {
    setError(null);
    try {
      await api.patch(base, patch);
      await reload();
    } catch (err) {
      /* A refused address stays beside the box that holds it. The box keeps
         what was typed, so the sentence and the text it is about agree. */
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }

  /* What the delete costs, in the numbers a person can check, asked when the
     row is pressed so no read of this page pays for it. */
  async function askDelete() {
    setDeliveries(null);
    confirm.ask();
    try {
      const answer = await api.get<{ deliveries: number }>(`${base}/count`);
      setDeliveries(answer.deliveries);
    } catch {
      confirm.cancel();
      notify("Could not count what goes with it.");
    }
  }

  async function rollSecret() {
    try {
      const res = await api.patch<{ secret: string }>(base, { roll: true });
      show(res.secret);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not roll the secret.");
    }
  }

  async function test() {
    try {
      await api.post(base);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not send a test.");
    }
  }

  async function remove() {
    try {
      forget();
      await api.del(base);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not delete the webhook.");
    }
  }

  if (confirm.asking) {
    const kept =
      deliveries === null ? null : `${deliveries} ${deliveries === 1 ? "delivery" : "deliveries"}`;
    return (
      <ConfirmRow
        question={
          kept === null
            ? `Delete this webhook? Counting what goes with it…`
            : `Delete this webhook? ${short(hook.url)} stops being called, and its ${kept} go with it.`
        }
        /* A question that does not name its cost must not be answerable. */
        pending={deliveries === null}
        confirmLabel="Yes, delete"
        onConfirm={() => confirm.confirm(() => void remove())}
        onCancel={confirm.cancel}
      />
    );
  }

  if (roll.asking) {
    return (
      <ConfirmRow
        question="Roll the secret? Every delivery is signed with the new one from now on, and a receiver that has not been told it will refuse them."
        confirmLabel="Yes, roll it"
        onConfirm={() => roll.confirm(() => void rollSecret())}
        onCancel={roll.cancel}
      />
    );
  }

  return (
    <div className={styles.hookBox} data-testid="webhook-box">
      <Row>
        <Input
          style={{ flex: 1, minWidth: 160 }}
          aria-label={`URL of the webhook ${hook.prefix}`}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setTyped(true);
          }}
          onBlur={() => {
            setTyped(false);
            if (!url.trim()) return setUrl(hook.url);
            if (urlEdit) void save({ url: urlEdit });
          }}
        />
        {!hook.active && <Tag>off</Tag>}
        <Spacer />
        <Button variant="ghost" onClick={() => void save({ active: !hook.active })}>
          {hook.active ? "Turn off" : "Turn on"}
        </Button>
        <IconButton
          danger
          label={`Delete the webhook ${hook.prefix}`}
          title="Delete this webhook"
          onClick={() => void askDelete()}
        >
          ✕
        </IconButton>
      </Row>

      <div className={styles.hookUnder}>
        {error && (
          <span className={styles.hookError} role="alert" data-testid="webhook-error">
            {error}
          </span>
        )}

        <Kinds kinds={hook.kinds} onPick={(kinds) => void save({ kinds })} />

        {secret && (
          <div className={styles.hookSecret} data-testid="webhook-secret">
            <Note>The secret — readable only here, only now.</Note>
            <CopyField value={secret} label="the webhook secret" loud />
          </div>
        )}

        <div className={styles.hookTools}>
          <span className={styles.tokenPrefix}>{hook.prefix}…</span>
          <Button variant="ghost" onClick={roll.ask}>
            Roll the secret
          </Button>
          <Button variant="ghost" onClick={() => void test()}>
            Send a test
          </Button>
        </div>

        <LastDelivery hook={hook} />
      </div>
    </div>
  );
}

/**
 * Which kinds ring this webhook. Nothing picked means every kind, which is
 * what a new webhook is and what most people want.
 */
function Kinds({ kinds, onPick }: { kinds: WebhookKind[]; onPick: (kinds: string[]) => void }) {
  const all = kinds.length === 0;
  return (
    <div className={styles.kinds} role="group" aria-label="What rings this webhook">
      <button
        type="button"
        aria-pressed={all}
        className={`${styles.kindChip} ${all ? styles.kindChipOn : ""}`}
        onClick={() => onPick([])}
      >
        Everything
      </button>
      {WEBHOOK_KINDS.map((kind) => {
        const on = kinds.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={on}
            className={`${styles.kindChip} ${on ? styles.kindChipOn : ""}`}
            onClick={() => onPick(on ? kinds.filter((k) => k !== kind) : [...kinds, kind])}
          >
            {WEBHOOK_KIND_LABEL[kind]}
          </button>
        );
      })}
    </div>
  );
}

/** One line: delivered 2m ago, or failed 4m ago — 500. */
function LastDelivery({ hook }: { hook: WebhookDTO }) {
  const last = hook.lastDelivery;
  /* The clock ticks for every state, not only while one is in flight: a line
     that said "0s ago" until somebody reloaded would be wrong within a
     minute, and the page is otherwise still. */
  const since = useElapsed(last?.at ?? new Date().toISOString(), last !== null);

  if (!last) {
    return (
      <span className={styles.hookLast} data-testid="webhook-last">
        <span className={styles.hookDot} />
        Nothing sent yet.
      </span>
    );
  }

  const dot =
    last.state === "delivered"
      ? styles.hookDotOk
      : last.state === "failed"
        ? styles.hookDotBad
        : styles.hookDotWaiting;

  return (
    <span className={styles.hookLast} data-testid="webhook-last">
      <span className={`${styles.hookDot} ${dot}`} />
      {last.state === "waiting" ? (
        <>sending…</>
      ) : last.state === "delivered" ? (
        <>delivered {since} ago</>
      ) : (
        <span className={styles.hookFail}>
          failed {since} ago{last.code ? ` — ${last.code}` : last.error ? ` — ${last.error}` : ""}
          {last.tries > 1 ? `, ${last.tries} tries` : ""}
        </span>
      )}
    </span>
  );
}

/** Enough of a URL to know which one a question is about. */
function short(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + parsed.pathname;
  } catch {
    return url;
  }
}
