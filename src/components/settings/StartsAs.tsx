"use client";

import { useId, useState } from "react";
import { useBoard } from "@/components/board/store";
import { seedNote } from "@/lib/filters";
import type { PropertyDTO, TaskValue } from "@/lib/types";
import { PropertyControl } from "@/components/board/controls/PropertyControl";
import { Input } from "@/components/ui/Form";
import { Note } from "@/components/ui/Layout";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import styles from "./settings.module.css";

/**
 * What a new task of this type starts with, on one property. The server
 * writes it on every create; this only says which value.
 */
export function StartsAs({
  property,
  optionId,
  canEdit,
}: {
  property: PropertyDTO;
  optionId: string;
  canEdit: boolean;
}) {
  const { data, send, refresh, notify } = useBoard();
  const labelId = useId();
  const value = property.config.defaults?.[optionId] ?? null;

  async function save(next: TaskValue) {
    /* An unticked box is what a task with no value already shows. */
    const kept = property.type === "checkbox" && next === false ? null : next;
    try {
      await send.patch(`/api/properties/${property.id}`, { defaults: { [optionId]: kept } });
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save.");
    }
  }

  if (!canEdit) {
    if (value === null) return null;
    const said = seedNote({}, data.properties, data.members, { [property.id]: value });
    return (
      <span className={styles.typeStarts}>
        <Note>{said.replace(/^s/, "S")}</Note>
      </span>
    );
  }
  return (
    <span className={styles.typeStarts} data-testid="starts-as">
      <span id={labelId} className={styles.typeStartsLabel}>
        Starts as
      </span>
      {property.type === "text" || property.type === "number" ? (
        <StartsAsBox
          property={property}
          optionId={optionId}
          value={value}
          labelId={labelId}
          save={save}
        />
      ) : (
        <PropertyControl
          property={property}
          value={value}
          members={data.members}
          today={data.today}
          labelId={labelId}
          onChange={(next) => void save(next)}
        />
      )}
    </span>
  );
}

/**
 * The words or the number a type starts with. A settings row that holds
 * words, so a blur saves it and a closed tab sends what it owes. The panel's
 * box cannot: it keeps its draft to itself.
 */
function StartsAsBox({
  property,
  optionId,
  value,
  labelId,
  save,
}: {
  property: PropertyDTO;
  optionId: string;
  value: TaskValue;
  labelId: string;
  save: (next: TaskValue) => Promise<void>;
}) {
  const { notify } = useBoard();
  const numeric = property.type === "number";
  const saved = value === null ? "" : String(value);
  /* Null is "whatever is saved", so another tab's change still shows. */
  const [draft, setDraft] = useState<string | null>(null);
  const read = (words: string): TaskValue | undefined => {
    if (!numeric) return words;
    const n = Number(words);
    return Number.isFinite(n) ? n : undefined;
  };
  /* What the box owes: nothing when it holds what is saved, a clear when it
     was emptied, and the value when it reads. A blur and a leave both send it. */
  const words = draft?.trim();
  const owed =
    words === undefined || words === saved ? undefined : words === "" ? null : read(words);
  useSaveOnLeave(() =>
    owed === undefined
      ? null
      : {
          method: "PATCH",
          url: `/api/properties/${property.id}`,
          body: { defaults: { [optionId]: owed } },
        },
  );

  function commit() {
    if (words === undefined) return;
    setDraft(null);
    if (words === saved) return;
    if (owed === undefined) notify(`${property.name} needs a number.`);
    else void save(owed);
  }

  return (
    <Input
      width="medium"
      aria-labelledby={labelId}
      inputMode={numeric ? "decimal" : undefined}
      value={draft ?? saved}
      placeholder="Nothing"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        /* Escape keeps the focus: a blur in the same breath would read the
           draft it just threw away, and save it. */
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}
