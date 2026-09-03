"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchTasks, type SearchHit } from "@/lib/search";
import type { TaskDTO } from "@/lib/types";
import { useDismiss } from "@/components/ui/useDismiss";
import { isTyping } from "./keys";
import { useBoard } from "./store";
import styles from "./board.module.css";

/**
 * The box in the top bar, and what it finds.
 *
 * It searches the project and not the view: a search opens one task and
 * changes nothing else, so hiding a hit because a filter is on would only
 * leave a person searching for a task they can see the key of. A hit the view
 * is not drawing says so on its own row instead.
 *
 * The box sits above the view strip because what it finds does not belong to a
 * view. The filter, which does, sits inside the strip.
 */
export function Search({ onOpenTask }: { onOpenTask: (task: TaskDTO) => void }) {
  const { data, visibleTasks } = useBoard();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const boxRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(close, open);

  const hits = useMemo(() => searchTasks(data.tasks, query), [data.tasks, query]);
  /* Which hits the view is drawing. A search reaches past the filter, so it
     owes the person a word about the ones the board behind it is not showing. */
  const shown = useMemo(() => new Set(visibleTasks.map((t) => t.id)), [visibleTasks]);

  /* `/` is the way in from anywhere on the board. It is a printable character,
     so it belongs to whatever field has the focus first. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      boxRef.current?.focus();
      boxRef.current?.select();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* A hit can go: somebody else deletes the task, or the words change under a
     highlight that was near the bottom of a longer list. */
  const highlighted = hits.length ? Math.min(at, hits.length - 1) : 0;
  const listOpen = open && query.trim() !== "";

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
            <span className={styles.filterNote}>No task by those words.</span>
          ) : (
            <div className={styles.searchList} role="listbox" id="board-search-hits">
              {hits.map((hit, i) => (
                <div
                  key={hit.task.id}
                  id={`board-search-hits-${i}`}
                  role="option"
                  aria-selected={i === highlighted}
                  data-testid="search-hit"
                  className={`${styles.searchItem} ${i === highlighted ? styles.searchItemAt : ""}`}
                  // The box keeps the focus, exactly as the filter panel does.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => openHit(hit)}
                >
                  <span className={styles.searchLine}>
                    <span className={styles.searchKey}>{hit.task.key}</span>
                    <span className={styles.searchTitle}>{hit.task.title}</span>
                    {!shown.has(hit.task.id) && (
                      <span className={styles.searchAway} title="A filter on this view hides it">
                        not in this view
                      </span>
                    )}
                  </span>
                  {hit.snippet && <span className={styles.searchSnippet}>{hit.snippet}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
