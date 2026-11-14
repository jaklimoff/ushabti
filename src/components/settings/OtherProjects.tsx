"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useBoard } from "@/components/board/store";
import { Button } from "@/components/ui/Button";
import { ConfirmRow } from "@/components/ui/ConfirmRow";
import { Checkbox, Label } from "@/components/ui/Form";
import { Card, Note, Row, Section } from "@/components/ui/Layout";
import { ProjectMark } from "@/components/ui/Marks";
import { api } from "@/lib/client";
import {
  blockedSaid,
  copyQuestion,
  countSaid,
  staysSaid,
  type LookCount,
  type LookParts,
} from "@/lib/look";
import styles from "./settings.module.css";

/** One project the person may copy from, as the look route counts it. */
type LookLine = { id: string; key: string; name: string; color: string; count: LookCount };

const BOTH: LookParts = { layout: true, looks: true };

/**
 * The look of this project's default card, copied from another project. It
 * is a copy and never a link, so it says so above the row. A person with no
 * other project has nothing to copy from, and sees no section.
 *
 * The counts and the words come from `lib/look.ts`, which the route asks
 * too, so the question names the numbers the write uses.
 */
export function OtherProjects() {
  const { data, send, refresh, notify } = useBoard();
  const projectId = data.project.id;
  const [lines, setLines] = useState<LookLine[] | null>(null);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [parts, setParts] = useState<LookParts>(BOTH);
  const copying = useRef(false);
  /* An answer that comes back after somebody asked again is not the answer. */
  const asked = useRef(0);
  const question = useRef<HTMLDivElement>(null);
  const copyId = useId();
  const fromId = useId();

  const load = useCallback(async () => {
    const mine = ++asked.current;
    try {
      const answer = await api.get<{ projects: LookLine[] }>(`/api/projects/${projectId}/look`);
      if (mine === asked.current) setLines(answer.projects);
    } catch {
      /* The section stays as it was; the press asks again. */
    }
  }, [projectId]);

  useEffect(() => {
    const mine = ++asked.current;
    void api
      .get<{ projects: LookLine[] }>(`/api/projects/${projectId}/look`)
      .then((answer) => mine === asked.current && setLines(answer.projects))
      .catch(() => {});
  }, [projectId]);

  /* The question opens on its first tick, not on Cancel, because nobody can
     answer it before they pick a project. */
  useEffect(() => {
    if (open) question.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [open]);

  if (!lines || lines.length === 0) return null;

  const picked = lines.find((l) => l.id === from) ?? null;
  const blocked = blockedSaid(picked !== null, parts);

  const ask = () => {
    setFrom(null);
    setParts(BOTH);
    setOpen(true);
    /* The counts may have moved since the page opened. */
    void load();
  };

  const cancel = () => setOpen(false);

  const copy = async () => {
    if (!picked || blocked || copying.current) return;
    copying.current = true;
    setOpen(false);
    try {
      await send.post(`/api/projects/${projectId}/look`, { from: picked.id, ...parts });
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "The look did not copy.");
    } finally {
      copying.current = false;
      void load();
    }
  };

  return (
    <Section
      title="Other projects"
      note="A copy, never a link. A later change in one project reaches no other until somebody copies again."
    >
      <Card>
        {open ? (
          <div
            ref={question}
            className={styles.lookAsk}
            data-testid="copy-look"
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              cancel();
            }}
          >
            <div className={styles.lookHead}>
              <span className={styles.actionTitle}>Copy from another project</span>
              <Note>This project takes another project&apos;s card layout, icons and colours.</Note>
            </div>
            <div className={styles.lookGrid}>
              <Label id={copyId} className={styles.lookLabel}>
                Copy
              </Label>
              <div className={styles.lookTicks} role="group" aria-labelledby={copyId}>
                <Checkbox
                  label="Card layout"
                  checked={parts.layout}
                  onChange={(e) => setParts((p) => ({ ...p, layout: e.target.checked }))}
                />
                <Checkbox
                  label="Icons and colours"
                  checked={parts.looks}
                  onChange={(e) => setParts((p) => ({ ...p, looks: e.target.checked }))}
                />
              </div>
              <Label id={fromId} className={styles.lookLabel}>
                From
              </Label>
              <div>
                <div className={styles.lookList} role="radiogroup" aria-labelledby={fromId}>
                  {lines.map((line) => (
                    <LookChoice
                      key={line.id}
                      line={line}
                      name={fromId}
                      parts={parts}
                      on={line.id === from}
                      onPick={() => setFrom(line.id)}
                    />
                  ))}
                </div>
                <p className={styles.lookSmall}>
                  Properties and options match by name. Only the default card is written: a view
                  with a card of its own keeps it. No property or option is made or removed.
                </p>
              </div>
            </div>
            <ConfirmRow
              question={blocked ?? copyQuestion(picked!.name, picked!.count, parts)}
              confirmLabel="Yes, copy"
              pending={blocked !== null}
              onConfirm={() => void copy()}
              onCancel={cancel}
            />
          </div>
        ) : (
          <Row className={styles.actionRow}>
            <div className={styles.actionSay}>
              <span className={styles.actionTitle}>Copy from another project</span>
              <Note>This project takes another project&apos;s card layout, icons and colours.</Note>
            </div>
            <Button variant="ghost" onClick={ask}>
              Copy from…
            </Button>
          </Row>
        )}
      </Card>
    </Section>
  );
}

function LookChoice({
  line,
  name,
  parts,
  on,
  onPick,
}: {
  line: LookLine;
  name: string;
  parts: LookParts;
  on: boolean;
  onPick: () => void;
}) {
  const counted = countSaid(line.count, parts);
  const stays = parts.layout || parts.looks ? staysSaid(line.count) : null;
  return (
    <label className={`${styles.lookLine} ${on ? styles.lookOn : ""}`} data-testid="look-line">
      <input
        type="radio"
        name={name}
        value={line.id}
        checked={on}
        onChange={onPick}
        className={styles.lookRadio}
      />
      <span className={styles.lookSay}>
        <span className={styles.lookName}>
          <ProjectMark projectKey={line.key} color={line.color} />
          {line.name}
        </span>
        <span className={styles.lookCount}>
          {counted}
          {stays && (
            <>
              {counted && ". "}
              <span className={styles.lookStays}>{stays}</span>
            </>
          )}
        </span>
      </span>
    </label>
  );
}
