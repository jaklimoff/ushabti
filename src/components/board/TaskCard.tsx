"use client";

import { forwardRef, useMemo } from "react";
import type { MemberDTO, PropertyDTO, TaskDTO } from "@/lib/types";
import { formatDate, leadProperty } from "@/lib/board";
import { Avatar } from "@/components/ui/Avatar";
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
    ghost,
    overlay,
    onOpen,
    style,
    dragProps,
  },
  ref,
) {
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
      onClick={onOpen}
      role="button"
      tabIndex={0}
      {...dragProps}
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
            <span className={styles.cardMeta} title="Comments">
              💬 {task.commentCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
