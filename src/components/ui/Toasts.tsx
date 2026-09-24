"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "./Button";
import styles from "./ui.module.css";

/**
 * One press a toast can offer. It is the same shape for every toast, so the
 * next one that needs a button does not grow a second kind.
 */
export type ToastAction = { label: string; run: () => void };

export type Toast = {
  id: number;
  text: string;
  kind: "error" | "info";
  action?: ToastAction;
  /** Keeps a toast with a button up while the pointer or the focus is on it. */
  hold?: (on: boolean) => void;
};

export type Notify = (text: string, kind?: Toast["kind"], action?: ToastAction) => void;

const TOAST_MS = 5200;

/* A button needs longer than a sentence: somebody has to read the line, find
   the button and reach it, perhaps with Tab from the far side of the board. */
const ACTION_TOAST_MS = 10000;

/**
 * The toasts of one page, and the one way to add one.
 *
 * A toast with a button holds while it is pointed at or focused, and goes
 * once it is let go after its time is over. A button that vanished under the
 * pointer, or out from under the focus, would be a button nobody can press.
 * Its press takes the toast away first, so a second press finds nothing and
 * cannot do the act twice.
 */
export function useToasts(): { toasts: Toast[]; notify: Notify } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const held = useRef(new Set<number>());
  const lapsed = useRef(new Set<number>());

  const drop = useCallback((id: number) => {
    held.current.delete(id);
    lapsed.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    (text, kind = "error", action) => {
      const id = (seq.current += 1);
      const toast: Toast = { id, text, kind };
      if (action) {
        let pressed = false;
        toast.action = {
          label: action.label,
          run: () => {
            if (pressed) return;
            pressed = true;
            drop(id);
            action.run();
          },
        };
        toast.hold = (on) => {
          if (on) return void held.current.add(id);
          held.current.delete(id);
          if (lapsed.current.has(id)) drop(id);
        };
      }
      setToasts((list) => [...list, toast]);
      setTimeout(
        () => {
          if (held.current.has(id)) lapsed.current.add(id);
          else drop(id);
        },
        action ? ACTION_TOAST_MS : TOAST_MS,
      );
    },
    [drop],
  );

  return { toasts, notify };
}

/**
 * Lives here rather than inside the board, because the settings page had a
 * working notify() and no way to show what it said. Every failure on that
 * page wrote to a state nothing read.
 *
 * Nothing here takes the focus. A toast arrives while somebody is working on
 * the board, and moving their cursor to it would send their next key to a
 * button they never chose. Its button is reached with Tab like any other.
 *
 * Each toast speaks for itself: an error as an alert, which a screen reader
 * reads at once, and anything else as a status, which waits its turn. The
 * stack is not a live region of its own, or an error would be read twice.
 */
export function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className={styles.toasts}>
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastRow({ toast }: { toast: Toast }) {
  const pointer = useRef(false);
  const focus = useRef(false);
  const say = () => toast.hold?.(pointer.current || focus.current);

  return (
    <div
      data-testid="toast"
      role={toast.kind === "error" ? "alert" : "status"}
      className={`${styles.toast} ${toast.kind === "error" ? styles.toastError : ""} ${
        toast.action ? styles.toastWithAction : ""
      }`}
      onPointerEnter={() => {
        pointer.current = true;
        say();
      }}
      onPointerLeave={() => {
        pointer.current = false;
        say();
      }}
      onFocus={() => {
        focus.current = true;
        say();
      }}
      onBlur={() => {
        focus.current = false;
        say();
      }}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <Button
          variant="ghost"
          className={styles.toastAction}
          data-testid="toast-action"
          onClick={toast.action.run}
        >
          {toast.action.label}
        </Button>
      )}
    </div>
  );
}
