"use client";

import { useId } from "react";
import { Label } from "@/components/ui/Form";
import { dateProperties, type TimelineDates } from "@/lib/timeline";
import type { PropertyDTO } from "@/lib/types";
import styles from "./board.module.css";

/**
 * The two questions a timeline asks: the date its bars start on, and the date
 * they end on. Only the project's date properties are offered, and the start
 * may be nothing. The New view panel and a timeline that lost its end both
 * draw this one, so the two ask the same way.
 */
export function TimelineDatesChips({
  properties,
  dates,
  onChange,
}: {
  properties: PropertyDTO[];
  dates: TimelineDates;
  onChange: (dates: TimelineDates) => void;
}) {
  const id = useId();
  const offered = dateProperties(properties);
  if (!offered.length)
    return (
      <span className={styles.popNote} data-testid="timeline-no-dates">
        Create a date property first.
      </span>
    );

  const row = (
    key: "start" | "end",
    label: string,
    picked: string | null,
    pick: (id: string | null) => void,
    nothing: boolean,
  ) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Label id={`${id}-${key}`}>{label}</Label>
      <div className={styles.chipRow} role="group" aria-labelledby={`${id}-${key}`}>
        {offered.map((property) => (
          <button
            key={property.id}
            type="button"
            className={`${styles.chip} ${picked === property.id ? styles.chipOn : ""}`}
            aria-pressed={picked === property.id}
            onClick={() => pick(property.id)}
          >
            {property.name}
          </button>
        ))}
        {nothing && (
          <button
            type="button"
            className={`${styles.chip} ${picked === null ? styles.chipOn : ""}`}
            aria-pressed={picked === null}
            onClick={() => pick(null)}
          >
            Nothing
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {row("start", "Starts on", dates.startBy, (startBy) => onChange({ ...dates, startBy }), true)}
      {row("end", "Ends on", dates.endBy, (endBy) => endBy && onChange({ ...dates, endBy }), false)}
      <span className={styles.popNote}>
        One bar for each task with an end date, from its start. A task with no start is one day.
      </span>
    </>
  );
}
