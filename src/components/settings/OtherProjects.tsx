"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useBoard } from "@/components/board/store";
import { Button } from "@/components/ui/Button";
import { ConfirmRow } from "@/components/ui/ConfirmRow";
import { Checkbox, Label } from "@/components/ui/Form";
import { Card, Note, Row, Section } from "@/components/ui/Layout";
import { ProjectMark } from "@/components/ui/Marks";
import { api } from "@/lib/client";
import { longAgo } from "@/lib/board";
import {
  appliedSaid,
  applyLabel,
  applyQuestion,
  blockedApplySaid,
  blockedSaid,
  copyQuestion,
  countSaid,
  missingSaid,
  staysSaid,
  type LookCount,
  type LookParts,
} from "@/lib/look";
import styles from "./settings.module.css";

/**
 * One other project of the person, as the look route counts it: `count` for
 * copying its look here, `applies` for putting this project's look there.
 */
type LookLine = {
  id: string;
  key: string;
  name: string;
  color: string;
  count: LookCount;
  applies: LookCount;
};

/** Where the look went, and when, for the line under the row. */
type Applied = { names: string[]; at: string };

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
  /* One row is the question at a time: opening one puts the other back. */
  const [open, setOpen] = useState<"copy" | "apply" | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [parts, setParts] = useState<LookParts>(BOTH);
  const [applied, setApplied] = useState<Applied | null>(null);
  const copying = useRef(false);
  /* An answer that comes back after somebody asked again is not the answer. */
  const asked = useRef(0);
  const question = useRef<HTMLDivElement>(null);
  const copyId = useId();
  const fromId = useId();
  const applyId = useId();
  const toId = useId();

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

  /* "Applied just now" grows older while the page stays open. */
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!applied) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [applied]);

  if (!lines || lines.length === 0) return null;

  const picked = lines.find((l) => l.id === from) ?? null;
  const blocked = blockedSaid(picked !== null, parts);
  /* In the person's Home order, as the lines are, whatever order they ticked. */
  const targets = lines.filter((l) => to.includes(l.id));
  const blockedApply = blockedApplySaid(targets.length, parts);
  const applyLooks = targets.reduce((n, l) => n + l.applies.looks, 0);

  const ask = () => {
    setFrom(null);
    setParts(BOTH);
    setOpen("copy");
    /* The counts may have moved since the page opened. */
    void load();
  };

  /* Every project starts ticked: the usual case is all of them, and the
     question names the count before anything is written. */
  const askApply = () => {
    setTo(lines.map((l) => l.id));
    setParts(BOTH);
    setOpen("apply");
    void load();
  };

  const cancel = () => setOpen(null);

  const apply = async () => {
    if (blockedApply || copying.current) return;
    copying.current = true;
    const names = targets.map((l) => l.name);
    setOpen(null);
    try {
      await send.post(`/api/projects/${projectId}/look/apply`, {
        to: targets.map((l) => l.id),
        ...parts,
      });
      setApplied({ names, at: new Date().toISOString() });
    } catch (err) {
      notify(err instanceof Error ? err.message : "The look did not apply.");
    } finally {
      copying.current = false;
      void load();
    }
  };

  const copy = async () => {
    if (!picked || blocked || copying.current) return;
    copying.current = true;
    setOpen(null);
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
        {open === "copy" ? (
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
        {open === "apply" ? (
          <div
            ref={question}
            className={styles.lookAsk}
            data-testid="apply-look"
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              cancel();
            }}
          >
            <div className={styles.lookHead}>
              <span className={styles.actionTitle}>Apply to other projects</span>
              <Note>
                The projects you pick take this project&apos;s card layout, icons and colours.
              </Note>
            </div>
            <div className={styles.lookGrid}>
              <Label id={applyId} className={styles.lookLabel}>
                Apply
              </Label>
              <div className={styles.lookTicks} role="group" aria-labelledby={applyId}>
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
              <Label id={toId} className={styles.lookLabel}>
                To
              </Label>
              <div>
                <div className={styles.lookList} role="group" aria-labelledby={toId}>
                  {lines.map((line) => (
                    <ApplyChoice
                      key={line.id}
                      line={line}
                      parts={parts}
                      on={to.includes(line.id)}
                      onTick={(on) =>
                        setTo((was) =>
                          on ? [...was, line.id] : was.filter((id) => id !== line.id),
                        )
                      }
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
              question={
                blockedApply ??
                applyQuestion(
                  targets.map((l) => l.name),
                  applyLooks,
                  parts,
                )
              }
              confirmLabel={applyLabel(targets.length)}
              pending={blockedApply !== null}
              onConfirm={() => void apply()}
              onCancel={cancel}
            />
          </div>
        ) : (
          <Row className={styles.actionRow}>
            <div className={styles.actionSay}>
              <span className={styles.actionTitle}>Apply to other projects</span>
              <Note>
                The projects you pick take this project&apos;s card layout, icons and colours.
              </Note>
              {applied && (
                <span className={styles.lookApplied} data-testid="look-applied">
                  {appliedSaid(applied.names, longAgo(applied.at))}
                </span>
              )}
            </div>
            <Button variant="ghost" onClick={askApply}>
              Apply to…
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

function ApplyChoice({
  line,
  parts,
  on,
  onTick,
}: {
  line: LookLine;
  parts: LookParts;
  on: boolean;
  onTick: (on: boolean) => void;
}) {
  const counted = countSaid(line.applies, parts);
  const missing = parts.layout || parts.looks ? missingSaid(line.applies) : null;
  const said = useId();
  return (
    <label className={`${styles.lookLine} ${on ? styles.lookOn : ""}`} data-testid="apply-line">
      {/* The tick is the project; its counts are what it says about it. */}
      <input
        type="checkbox"
        value={line.id}
        checked={on}
        onChange={(e) => onTick(e.target.checked)}
        className={styles.lookRadio}
        aria-label={line.name}
        aria-describedby={said}
      />
      <span className={styles.lookSay}>
        <span className={styles.lookName}>
          <ProjectMark projectKey={line.key} color={line.color} />
          {line.name}
        </span>
        <span className={styles.lookCount} id={said}>
          {counted}
          {missing && (
            <>
              {counted && ". "}
              <span className={styles.lookStays}>{missing}</span>
            </>
          )}
        </span>
      </span>
    </label>
  );
}
