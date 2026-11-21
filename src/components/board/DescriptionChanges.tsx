"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { DescriptionVersionDTO } from "@/lib/description-versions";
import {
  countRows,
  countSaid,
  diffLines,
  foldRows,
  foldSaid,
  type DiffFold,
  type DiffRow,
} from "@/lib/text-diff";
import { Button } from "@/components/ui/Button";
import styles from "./panel.module.css";

export type PutBackAnswer = "saved" | "changed" | "failed";

/**
 * The versions the panel read, kept while it stays on one task. A version
 * never changes once a later one exists, and the newest one only moves its
 * `after` within a burst of one actor's edits, which a put-back does not read.
 * So it is read once, on the first open, as a past run is.
 */
export function useVersions(taskId: string) {
  const [kept, setKept] = useState<{
    taskId: string;
    seen: Record<string, DescriptionVersionDTO>;
  }>({ taskId, seen: {} });
  const seen = kept.taskId === taskId ? kept.seen : {};
  /* The task the panel is on now, read when an answer lands. */
  const open = useRef(taskId);
  useEffect(() => {
    open.current = taskId;
  }, [taskId]);
  const read = useCallback(
    async (versionId: string) => {
      const res = await api.get<{ version: DescriptionVersionDTO }>(
        `/api/tasks/${taskId}/description-versions/${versionId}`,
      );
      // A version asked for before another task opened lands nowhere.
      if (open.current !== taskId) return;
      setKept((current) => ({
        taskId,
        seen: { ...(current.taskId === taskId ? current.seen : {}), [versionId]: res.version },
      }));
    },
    [taskId],
  );
  return { seen, read };
}

export type Versions = ReturnType<typeof useVersions>;

/** The words after a line that names a version: open it, or close it. */
export function ChangesToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={styles.changesToggle}
      aria-expanded={open}
      data-testid="description-changes-toggle"
      onClick={onToggle}
    >
      {open ? "Hide changes" : "Show changes"}
    </button>
  );
}

const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

/**
 * What the question says a put-back costs. The counts hold only while the
 * edit is the newest, so with later edits it says those go too, without
 * numbers it would have to guess.
 */
export function putBackQuestion(
  counts: { gone: number; added: number },
  newest: boolean,
  actor: { id: string; name: string } | null,
  meId: string,
): string {
  const ask = "Put the description back as it was before this edit?";
  const tail = "What is there now stays in the history.";
  if (!newest) return `${ask} Everything written since goes too. ${tail}`;
  const who = !actor ? "" : actor.id === meId ? " you" : ` ${actor.name}`;
  const parts: string[] = [];
  if (counts.added)
    parts.push(`the ${lines(counts.added)}${who} added ${counts.added === 1 ? "goes" : "go"}`);
  if (counts.gone)
    parts.push(`the ${lines(counts.gone)} ${counts.gone === 1 ? "comes" : "come"} back`);
  if (!parts.length) return `${ask} ${tail}`;
  const said = parts.join(", and ");
  return `${ask} ${said[0].toUpperCase()}${said.slice(1)}. ${tail}`;
}

/**
 * One edit of the description, opened under its line: the Markdown as it was
 * written, line by line in one column, and under it the way back.
 */
export function DescriptionChanges({
  versionId,
  versions,
  current,
  mayEdit,
  meId,
  putBack,
}: {
  versionId: string;
  versions: Versions;
  /** The description as it is now. */
  current: string;
  mayEdit: boolean;
  meId: string;
  putBack: (version: DescriptionVersionDTO, current: string) => Promise<PutBackAnswer>;
}) {
  const version = versions.seen[versionId];
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);
  const { read } = versions;
  useEffect(() => {
    if (version || asked.current) return;
    asked.current = true;
    read(versionId).catch(() => setFailed(true));
  }, [read, version, versionId]);

  if (!version) {
    return (
      <div className={styles.changes} data-testid="description-changes">
        <span className={styles.changesNote}>
          {failed ? "Those changes did not load." : "Loading…"}
        </span>
      </div>
    );
  }
  return (
    <ChangesOf
      version={version}
      current={current}
      mayEdit={mayEdit}
      meId={meId}
      putBack={putBack}
    />
  );
}

function ChangesOf({
  version,
  current,
  mayEdit,
  meId,
  putBack,
}: {
  version: DescriptionVersionDTO;
  current: string;
  mayEdit: boolean;
  meId: string;
  putBack: (version: DescriptionVersionDTO, current: string) => Promise<PutBackAnswer>;
}) {
  const [rows] = useState(() => diffLines(version.before, version.after));
  const counts = countRows(rows);
  const [unfolded, setUnfolded] = useState<Set<number>>(() => new Set());
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const going = useRef(false);

  async function yes() {
    // The answer of the first press is still on its way.
    if (going.current) return;
    going.current = true;
    setBusy(true);
    try {
      await putBack(version, current);
    } finally {
      going.current = false;
      setBusy(false);
      setAsking(false);
    }
  }

  const offered = mayEdit && current !== version.before;
  const items = foldRows(rows);

  return (
    <>
      <div className={styles.changes} data-testid="description-changes">
        <div className={styles.changesHead} data-testid="description-changes-count">
          {countSaid(counts)}
        </div>
        {items.map((item, i) =>
          item.kind === "fold" ? (
            unfolded.has(i) ? (
              item.rows.map((row, j) => <Line key={`${i}-${j}`} row={row} />)
            ) : (
              <button
                key={i}
                type="button"
                className={styles.changesFold}
                data-testid="description-changes-fold"
                onClick={() => setUnfolded((was) => new Set(was).add(i))}
              >
                {foldSaid((item as DiffFold).rows.length)}
              </button>
            )
          ) : (
            <Line key={i} row={item} />
          ),
        )}
      </div>
      {offered &&
        (asking ? (
          <div
            className={styles.putBackAsk}
            role="alertdialog"
            aria-label="Put the description back"
            data-testid="put-back-question"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setAsking(false);
              }
            }}
          >
            <span className={styles.putBackSaid}>
              {putBackQuestion(counts, current === version.after, version.actor, meId)}
            </span>
            <span className={styles.putBackActions}>
              <Button variant="primary" autoFocus busy={busy} onClick={() => void yes()}>
                Yes, put it back
              </Button>
              <Button variant="ghost" onClick={() => setAsking(false)}>
                Leave it
              </Button>
            </span>
          </div>
        ) : (
          <Button
            variant="ghost"
            className={styles.putBack}
            data-testid="put-back"
            onClick={() => setAsking(true)}
          >
            Put back what was here before
          </Button>
        ))}
    </>
  );
}

/** One line of the changes. The sign says it; the wash only repeats it. */
function Line({ row }: { row: DiffRow }) {
  const sign = row.kind === "gone" ? "−" : row.kind === "added" ? "+" : "";
  const className =
    row.kind === "gone"
      ? `${styles.changesLine} ${styles.changesGone}`
      : row.kind === "added"
        ? `${styles.changesLine} ${styles.changesAdded}`
        : styles.changesLine;
  return (
    <div className={className} data-testid={`changes-${row.kind}`}>
      <span className={styles.changesSign}>{sign}</span>
      <span className={styles.changesText}>
        {row.kind !== "same" && row.pieces
          ? row.pieces.map((piece, i) =>
              piece.marked ? (
                <mark key={i} className={styles.changesMark} data-testid="changes-mark">
                  {piece.text}
                </mark>
              ) : (
                piece.text
              ),
            )
          : row.text || " "}
      </span>
    </div>
  );
}
