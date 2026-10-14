"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "@/lib/client";
import {
  hitNote,
  joinArchived,
  searchCounted,
  type ArchivedFound,
  type Searchable,
  type SearchHit,
} from "@/lib/search";
import { useDismiss } from "@/components/ui/useDismiss";
import { useHighlightInView } from "./Ask";
import { useShortcut } from "./keys";
import { useBoard } from "./store";
import styles from "./board.module.css";

/**
 * The box in the top bar, and what it finds.
 *
 * It searches the project and not the view: a search opens one task and
 * changes nothing else, so hiding a hit because a filter is on would only
 * leave a person searching for a task they can see the key of. A hit the view
 * is not drawing says so on its own row instead — and so does an archived
 * task, which no view draws at all and which this box is the way back to.
 *
 * The box sits above the view strip because what it finds does not belong to a
 * view. The filter, which does, sits inside the strip.
 */
export function Search({ onOpenTask }: { onOpenTask: (task: Searchable) => void }) {
  const { data, visibleTasks, picked, clearPicks } = useBoard();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const boxRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(close, open);

  /* The archived tasks join the live ones here and nowhere else on the board.
     A search is what makes an archived task reachable again. */
  const local = useMemo(
    () => searchCounted([...data.tasks, ...data.archived], query, data.project.doneWhen),
    [data.archived, data.tasks, data.project.doneWhen, query],
  );

  /*
   * The board carries an archived task without its description, so the words
   * in those are asked of the server. The answer is held beside the words it
   * answers: an answer to words the box no longer holds matches nothing and
   * is never drawn.
   */
  const asked = query.trim().toLowerCase();
  const askArchive = asked !== "" && data.archived.length > 0;
  const [found, setFound] = useState<{ asked: string; result: ArchivedFound } | null>(null);
  useEffect(() => {
    if (!askArchive) return;
    let gone = false;
    /* A short wait, so a word typed fast asks once rather than per key. */
    const wait = setTimeout(() => {
      api
        .get<ArchivedFound>(
          `/api/projects/${data.project.id}/search?q=${encodeURIComponent(asked)}`,
        )
        .catch(() => null)
        .then((result) => {
          /* A failed ask finds nothing more; the browser's half still stands. */
          const sure = Array.isArray(result?.hits) ? result : { hits: [], total: 0 };
          if (!gone) setFound({ asked, result: sure });
        });
    }, 150);
    return () => {
      gone = true;
      clearTimeout(wait);
    };
  }, [askArchive, asked, data.project.id]);
  const answered = askArchive ? (found?.asked === asked ? found.result : null) : null;
  const looking = askArchive && found?.asked !== asked;

  /* A task put back or deleted since the server answered is no longer an
     archived hit. */
  const { hits, total } = useMemo(() => {
    if (!answered) return local;
    const still = new Set(data.archived.map((t) => t.id));
    const kept = answered.hits.filter((hit) => still.has(hit.task.id));
    return joinArchived(local, {
      hits: kept,
      total: answered.total - (answered.hits.length - kept.length),
    });
  }, [answered, data.archived, local]);
  /* Which hits the view is drawing. A search reaches past the filter, so it
     owes the person a word about the ones the board behind it is not showing. */
  const shown = useMemo(() => new Set(visibleTasks.map((t) => t.id)), [visibleTasks]);

  /*
   * `/` is the way in from anywhere on the board, and it wins over a pick.
   *
   * Below 900 px the pick bar takes the box off the top bar, so the key had
   * nothing to focus and did nothing at all. A search hides nothing, writes
   * nothing and ends by opening one task, while a pick is a handful of cards
   * held for a moment — so one press drops the picks and the box is there.
   *
   * The drop is flushed because a box that is not drawn cannot take the
   * focus. The bar has to be gone, and the box back on the bar, before the
   * focus is asked for.
   */
  useShortcut("/", () => {
    if (picked.length) flushSync(() => clearPicks());
    boxRef.current?.focus();
    boxRef.current?.select();
    setOpen(true);
  });

  /* A hit can go: somebody else deletes the task, or the words change under a
     highlight that was near the bottom of a longer list. */
  const highlighted = hits.length ? Math.min(at, hits.length - 1) : 0;
  const listOpen = open && query.trim() !== "";
  const list = useHighlightInView(highlighted, listOpen);

  const note = (hit: SearchHit) => hitNote(hit.task, shown.has(hit.task.id));

  function openHit(hit: SearchHit) {
    onOpenTask(hit.task);
    /* The words stay in the box. The panel is the thing on screen now, and
       coming back to the same list is how somebody works through three hits. */
    setOpen(false);
    boxRef.current?.blur();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      boxRef.current?.blur();
      return;
    }
    if (!listOpen || hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      return setAt((n) => (n + 1) % hits.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      return setAt((n) => (n - 1 + hits.length) % hits.length);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openHit(hits[highlighted]);
    }
  }

  return (
    <div className={styles.searchAnchor} ref={ref}>
      <input
        ref={boxRef}
        className={styles.searchBox}
        role="combobox"
        aria-expanded={listOpen}
        // The list exists only while there is something in it, so the box
        // points at it only then.
        aria-controls={listOpen && hits.length ? "board-search-hits" : undefined}
        aria-activedescendant={
          listOpen && hits.length ? `board-search-hits-${highlighted}` : undefined
        }
        aria-label="Find a task by its key, its title or its words"
        data-testid="search-box"
        placeholder="Find a task"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setAt(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {/* The key that opens the box, on the box. Nothing else says it. */}
      {query === "" && (
        <span className={styles.searchSlash} aria-hidden>
          /
        </span>
      )}

      {listOpen && (
        <div className={`${styles.popover} ${styles.searchPop}`} data-testid="search-hits">
          {hits.length === 0 ? (
            <span className={styles.filterNote}>
              {looking ? "Looking through the archive…" : "No task by those words."}
            </span>
          ) : (
            <>
              <div className={styles.searchList} role="listbox" id="board-search-hits" ref={list}>
                {hits.map((hit, i) => (
                  <div
                    key={hit.task.id}
                    id={`board-search-hits-${i}`}
                    role="option"
                    aria-selected={i === highlighted}
                    data-at={i === highlighted}
                    data-testid="search-hit"
                    className={`${styles.searchItem} ${i === highlighted ? styles.searchItemAt : ""}`}
                    // The box keeps the focus, exactly as the filter panel does.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openHit(hit)}
                  >
                    <span className={styles.searchLine}>
                      <span className={styles.searchKey}>{hit.task.key}</span>
                      <span className={styles.searchTitle}>{hit.task.title}</span>
                      {note(hit) && (
                        <span
                          className={styles.searchAway}
                          title={
                            hit.task.archivedAt
                              ? "It is archived. Open it to put it back."
                              : "A filter on this view hides it"
                          }
                        >
                          {note(hit)}
                        </span>
                      )}
                    </span>
                    {hit.snippet && <span className={styles.searchSnippet}>{hit.snippet}</span>}
                  </div>
                ))}
              </div>
              {/* Outside the scroller, or it scrolls out of sight. It is the
                last thing in the popover, so it is read after the hits. */}
              {total > hits.length && (
                <span className={styles.filterNote} data-testid="search-count" aria-live="polite">
                  {hits.length} of {total}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
