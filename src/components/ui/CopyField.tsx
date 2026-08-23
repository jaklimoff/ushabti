"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import styles from "./ui.module.css";

/**
 * A value the person has to get out of the browser and into a terminal.
 * Selecting the text by hand worked, but nothing told them it had worked, and
 * an agent token is readable exactly once.
 */
export function CopyField({
  value,
  label,
  loud = false,
}: {
  value: string;
  /** What the button says it is copying, for a screen reader. */
  label: string;
  loud?: boolean;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    // The text stays selectable, so a refused clipboard still leaves the
    // person a way to take the value by hand.
    if (!(await copyText(value))) return;
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1800);
  }

  return (
    <div className={`${styles.copy} ${loud ? styles.copyLoud : ""}`}>
      <code className={styles.copyText}>{value}</code>
      <button
        type="button"
        className={`${styles.copyBtn} ${done ? styles.copyDone : ""}`}
        aria-label={done ? `${label} copied` : `Copy ${label}`}
        onClick={() => void copy()}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
