"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
  type TextareaHTMLAttributes,
} from "react";
import { flushSync } from "react-dom";
import { markdownLine } from "@/lib/attachments";
import { uploadFile } from "@/lib/upload-client";
import { insertLines, replaceFirst, uploadingLine } from "@/lib/uploads";
import type { PreviewContext } from "@/lib/live-markdown";
import { MentionList, useMentions, type TextBox } from "./Mentions";
import styles from "./panel.module.css";

type Send = <T>(write: () => Promise<T>) => Promise<T>;

/* The native key event, handed to handlers typed for React's. They read only
   the key, the modifiers, the target and the two stops, which both have. */
type KeyboardEventLike = KeyboardEvent<HTMLTextAreaElement>;

type BoxProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "ref">;

/* CodeMirror comes in its own chunk, so the board itself does not carry it.
   The panel asks for it as it opens, so a click on the description does not
   wait for the download. */
export const loadLiveEditor = () => import("./LiveEditor");
const LiveEditor = lazy(loadLiveEditor);

/**
 * The one box a person writes markdown in: the description, the edit of a
 * comment and the composer. It holds the `@` list, and it takes a dropped or
 * pasted file: the upload starts at once, a line at the cursor says how far
 * it got, and the line becomes the file's markdown when it is ready.
 *
 * It decides nothing about saving, as `PropertyControl` does not. Each place
 * keeps its own save and asks `onUploading` whether a file is still on its
 * way. With `live`, the box is a CodeMirror editor that shows every line
 * rendered but the cursor's; only the description passes it so far.
 */
export function MarkdownBox({
  taskId,
  value,
  onChange,
  send,
  onUploading,
  onUploaded,
  boxRef,
  live = false,
  preview,
  onKeyDown,
  onSelect,
  onBlur,
  ...rest
}: BoxProps & {
  taskId: string;
  value: string;
  /** How this box keeps its words. Typing, a picked name and an upload all write through it. */
  onChange: (text: string) => void;
  /** Every write is watched, so a read of the task that crosses one is asked again. */
  send: Send;
  /**
   * How many files are still on their way. When one lands it carries the
   * words as they are now; a stop that dropped them all carries none.
   */
  onUploading?: (count: number, words?: string) => void;
  /** A file is ready, so the task's file list has one more. */
  onUploaded?: () => void;
  boxRef?: RefObject<TextBox | null>;
  /** A CodeMirror box whose lines read as rendered markdown, but the cursor's. */
  live?: boolean;
  /** What a live box draws files and keys by, as the page does. */
  preview?: PreviewContext;
}) {
  const own = useRef<TextBox>(null);
  const ref = boxRef ?? own;
  const [refused, setRefused] = useState<{ taskId: string; said: string } | null>(null);

  /* An upload answers long after it started, so it asks for the words as
     they are then. A write sets them at once, before React renders them, so
     two answers in one tick do not undo each other. */
  const text = useRef(value);
  text.current = value;
  const latest = useRef({ onChange, onUploading, onUploaded, send });
  latest.current = { onChange, onUploading, onUploaded, send };
  function write(next: string) {
    text.current = next;
    latest.current.onChange(next);
  }

  const picker = useMentions(ref, write);

  /* The files go one after another, so the lines fill in the order they
     were written. Another task, or a box that closed, stops them all: an
     answer about one task must never land in the words of the next. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const stop = useRef<AbortController | null>(null);
  const inFlight = useRef(0);
  function count(by: number) {
    inFlight.current += by;
    latest.current.onUploading?.(inFlight.current, text.current);
  }
  useEffect(() => {
    const controller = new AbortController();
    stop.current = controller;
    queue.current = Promise.resolve();
    return () => {
      controller.abort();
      if (inFlight.current === 0) return;
      inFlight.current = 0;
      latest.current.onUploading?.(0);
    };
  }, [taskId]);

  async function run(file: File, first: string, signal: AbortSignal) {
    let line = first;
    try {
      const ready = await uploadFile(
        taskId,
        file,
        (percent) => {
          const said = uploadingLine(file.name, percent);
          if (signal.aborted || said === line) return;
          const next = replaceFirst(text.current, line, said);
          line = said;
          if (next !== null) write(next);
        },
        signal,
        latest.current.send,
      );
      if (signal.aborted) return;
      const next = replaceFirst(text.current, line, markdownLine(ready.id, ready.name));
      if (next !== null) write(next);
      latest.current.onUploaded?.();
    } catch (err) {
      if (signal.aborted) return;
      const next =
        replaceFirst(text.current, `${line}\n`, "") ?? replaceFirst(text.current, line, "");
      if (next !== null) write(next);
      setRefused({ taskId, said: err instanceof Error ? err.message : "The file did not upload." });
    } finally {
      if (!signal.aborted) count(-1);
    }
  }

  function take(files: File[]) {
    const signal = stop.current?.signal;
    if (!signal || files.length === 0) return;
    setRefused(null);
    const el = ref.current;
    const lines = files.map((f) => uploadingLine(f.name, 0));
    const next = insertLines(text.current, el?.selectionStart ?? text.current.length, lines);
    /* The render that takes the words moves the caret to the end, so it is
       put back after that render, as a picked name does. */
    /* Counted first, so the render that draws the lines already knows they
       stand for files on their way. */
    count(files.length);
    flushSync(() => write(next.text));
    el?.focus();
    el?.setSelectionRange(next.caret, next.caret);
    files.forEach((file, i) => {
      queue.current = queue.current.then(() => run(file, lines[i], signal));
    });
  }

  function onDragOver(e: DragEvent<HTMLTextAreaElement>) {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }
  function onDrop(e: DragEvent<HTMLTextAreaElement>) {
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    e.preventDefault();
    take(files);
  }
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return;
    e.preventDefault();
    take(files);
  }

  if (live)
    return (
      <>
        <Suspense fallback={<div className={rest.className} />}>
          <LiveEditor
            boxRef={ref}
            value={value}
            className={rest.className}
            placeholder={rest.placeholder}
            autoFocus={rest.autoFocus}
            preview={preview}
            onChange={(text) => write(text)}
            onSelect={() => picker.sync()}
            onKeyDown={(e) => {
              const key = e as unknown as KeyboardEventLike;
              if (picker.onKeyDown(key)) return true;
              onKeyDown?.(key);
              return e.defaultPrevented;
            }}
            onFocus={() => rest.onFocus?.(undefined as never)}
            onBlur={() => {
              picker.close();
              onBlur?.(undefined as never);
            }}
            onFiles={take}
          />
        </Suspense>
        <MentionList picker={picker} />
        {refused?.taskId === taskId && (
          <span className={styles.boxRefused} role="status" data-testid="upload-refused">
            {refused.said}
          </span>
        )}
      </>
    );

  return (
    <>
      <textarea
        {...rest}
        ref={ref as RefObject<HTMLTextAreaElement | null>}
        value={value}
        onChange={(e) => {
          write(e.target.value);
          picker.sync();
        }}
        onSelect={(e) => {
          picker.sync();
          onSelect?.(e);
        }}
        onBlur={(e) => {
          picker.close();
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          /* The list has the keys while it is open, so Enter picks a name and
             Escape closes the list and leaves the words alone. */
          if (picker.onKeyDown(e)) return;
          onKeyDown?.(e);
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onPaste={onPaste}
      />
      <MentionList picker={picker} />
      {refused?.taskId === taskId && (
        <span className={styles.boxRefused} role="status" data-testid="upload-refused">
          {refused.said}
        </span>
      )}
    </>
  );
}
