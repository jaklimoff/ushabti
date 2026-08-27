"use client";

import { forwardRef, useMemo } from "react";
import type { AgentRunDTO, MemberDTO, PropertyDTO, TaskDTO } from "@/lib/types";
import { formatDate, leadProperty } from "@/lib/board";
import { elapsed, isOpen, lifeOf, LIFE_WORD, runLine } from "@/lib/run-state";
import { Avatar } from "@/components/ui/Avatar";
import { useNow } from "@/components/ui/useElapsed";
import { useBoard } from "./store";
import styles from "./board.module.css";

export type CardFields = {
  lead: { color: string; label: string } | null;
  dots: { color: string; name: string }[];
  people: MemberDTO[];
  badges: { color: string; text: string }[];
  metas: string[];
};

/** Turns the property values of a task into the small parts a card shows. */
export function cardFields(
  task: TaskDTO,
  properties: PropertyDTO[],
  members: MemberDTO[],
  groupPropertyId: string | null,
): CardFields {
  const fields: CardFields = { lead: null, dots: [], people: [], badges: [], metas: [] };
  const leadId = leadProperty(properties, groupPropertyId)?.id ?? null;

  for (const property of properties) {
    if (property.id === groupPropertyId) continue;
    if (property.config.showOnCard === false) continue;

    const value = task.values[property.id];
    if (value === null || value === undefined || value === "") continue;

    switch (property.type) {
      case "select": {
        const option = property.options.find((o) => o.id === value);
        if (!option) break;
        if (property.id === leadId) {
          fields.lead = { color: option.color, label: `${property.name}: ${option.name}` };
        } else {
          fields.badges.push({ color: option.color, text: option.name });
        }
        break;
      }
      case "multi_select": {
        if (!Array.isArray(value)) break;
        for (const id of value) {
          const option = property.options.find((o) => o.id === id);
          if (option) fields.dots.push({ color: option.color, name: option.name });
        }
        break;
      }
      case "person": {
        const member = members.find((m) => m.id === value);
        if (member) fields.people.push(member);
        break;
      }
      case "date":
        fields.metas.push(formatDate(String(value)));
        break;
      case "number":
        fields.metas.push(`${property.name} ${value}`);
        break;
      case "checkbox":
        if (value === true) fields.metas.push(property.name);
        break;
      case "text":
        fields.metas.push(String(value).slice(0, 24));
        break;
    }
  }

  return fields;
}

type Props = {
  task: TaskDTO;
  properties: PropertyDTO[];
  members: MemberDTO[];
  groupPropertyId: string | null;
  selected?: boolean;
  /** This card carries the board cursor, so it is the board's tab stop. */
  cursor?: boolean;
  ghost?: boolean;
  overlay?: boolean;
  onOpen?: () => void;
  style?: React.CSSProperties;
  dragProps?: Record<string, unknown>;
};

export const TaskCard = forwardRef<HTMLDivElement, Props>(function TaskCard(
  {
    task,
    properties,
    members,
    groupPropertyId,
    selected,
    cursor,
    ghost,
    overlay,
    onOpen,
    style,
    dragProps,
  },
  ref,
) {
  const { runOf } = useBoard();
  const run = runOf(task.id);

  const fields = useMemo(
    () => cardFields(task, properties, members, groupPropertyId),
    [task, properties, members, groupPropertyId],
  );

  const hasFooter =
    fields.badges.length > 0 ||
    fields.metas.length > 0 ||
    task.checklistTotal > 0 ||
    task.commentCount > 0;

  const className = [
    styles.card,
    selected ? styles.cardSelected : "",
    ghost ? styles.cardGhost : "",
    overlay ? styles.cardOverlay : "",
  ]
    .filter(Boolean)
    .join(" ");

  // dnd-kit puts its keyboard handler in dragProps. Ours has to run after it,
  // and only when the drag sensor did not already claim the key.
  const dragKeyDown = dragProps?.onKeyDown as
    ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;

  return (
    <div
      ref={ref}
      className={className}
      data-testid={overlay ? "card-overlay" : "card"}
      style={style}
      data-task-id={task.id}
      onClick={onOpen}
      role="button"
      {...dragProps}
      /* dnd-kit hands every card a tab stop. The board keeps one, so Tab
         reaches the cursor in one press and the arrow keys move it. */
      tabIndex={cursor && !overlay ? 0 : -1}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        dragKeyDown?.(event);
        if (event.key === "Enter" && !event.defaultPrevented && onOpen) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className={styles.cardTop}>
        {fields.lead && (
          <span
            className={styles.prioSquare}
            data-testid="card-lead-square"
            style={{ background: fields.lead.color }}
            title={fields.lead.label}
          />
        )}
        <span className={styles.cardKey}>{task.key}</span>
        <span style={{ flex: 1 }} />
        {fields.dots.slice(0, 4).map((dot, i) => (
          <span
            key={`${dot.name}-${i}`}
            className={styles.labelDot}
            style={{ background: dot.color }}
            title={dot.name}
          />
        ))}
        {fields.people.slice(0, 2).map((person) => (
          <Avatar key={person.id} name={person.name} color={person.color} size={17} />
        ))}
      </div>

      <div className={styles.cardTitle} data-testid="card-title">
        {task.title}
      </div>

      {hasFooter && (
        <div className={styles.cardMetaRow}>
          {fields.badges.map((badge, i) => (
            <span key={`${badge.text}-${i}`} className={styles.cardBadge}>
              <span className={styles.cardBadgeDot} style={{ background: badge.color }} />
              <span className={styles.cardBadgeText}>{badge.text}</span>
            </span>
          ))}
          {fields.metas.map((meta, i) => (
            <span key={`${meta}-${i}`} className={styles.cardMeta}>
              {meta}
            </span>
          ))}
          {task.checklistTotal > 0 && (
            <span className={styles.cardProgress} title="Checklist">
              <span className={styles.cardProgressBar}>
                <span
                  className={styles.cardProgressFill}
                  style={{ width: `${(task.checklistDone / task.checklistTotal) * 100}%` }}
                />
              </span>
              {task.checklistDone}/{task.checklistTotal}
            </span>
          )}
          {task.commentCount > 0 && (
            <span className={styles.cardComments} title="Comments">
              <CommentIcon />
              {task.commentCount}
            </span>
          )}
        </div>
      )}

      {run && <CardRun run={run} overlay={overlay === true} />}
    </div>
  );
});

/** A hairline speech bubble. The board draws its own shapes; no icon set. */
function CommentIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">
      <path
        d="M3 2h6a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5.2L3 11.3V9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The strip of the board design: who is working, what it is doing, how long it
 * has been at it, and a bar that scans while it lives. The plan and the log
 * belong to the panel; a board full of runs has to stay readable.
 */
function CardRun({ run, overlay }: { run: AgentRunDTO; overlay: boolean }) {
  const now = useNow(isOpen(run.status));
  const life = lifeOf(run, now);
  const paused = run.status === "paused";

  // A run that answers shows how long it has worked. One that has gone quiet
  // shows how long ago it last said anything, because that is the number a
  // person needs, and the strip has room for one.
  const since = elapsed(life === "reporting" ? run.startedAt : run.updatedAt, now);

  return (
    <div className={styles.runStrip} data-testid="card-run" data-life={life}>
      <div className={styles.runStripRow}>
        <span className={styles.runAgent}>{run.agent.name}</span>
        <span className={styles.runText} data-testid="card-run-step">
          {overlay ? "Drop to take over" : runLine(run)}
        </span>
        <span
          className={`${styles.runTime} ${life === "reporting" ? "" : styles.runTimeStale}`}
          data-testid="card-run-time"
        >
          {life === "reporting" ? since : `${LIFE_WORD[life]} ${since}`}
        </span>
      </div>
      <span className={styles.runScan} aria-hidden>
        <span
          className={`${styles.runScanFill} ${paused || life === "silent" ? styles.runScanPaused : ""}`}
        />
      </span>
    </div>
  );
}
