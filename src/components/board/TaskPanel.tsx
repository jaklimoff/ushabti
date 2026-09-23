"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { copyText } from "@/lib/clipboard";
import { clampPanelWidth, longAgo, PANEL_MIN_WIDTH, relativeTime } from "@/lib/board";
import { cardAccent } from "@/lib/card-view";
import { commentDraftKey } from "@/lib/draft";
import { editedText } from "@/lib/leave";
import { tint } from "@/lib/colors";
import {
  duration,
  elapsed,
  isOpen,
  isWaiting,
  leaseLeft,
  lifeOf,
  LIFE_WORD,
  pastRunWords,
  progressOf,
  runLine,
  STATUS_WORD,
} from "@/lib/run-state";
import { checklistField, editingSaid } from "@/lib/presence";
import { searchTasks } from "@/lib/search";
import type {
  AgentRunDetailDTO,
  AgentRunLogDTO,
  AgentRunRowDTO,
  AgentRunStepDTO,
  ChecklistItemDTO,
  RunControl,
  TaskDTO,
  TaskDetailDTO,
  TaskLinkDTO,
  TaskValue,
} from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { useNow } from "@/components/ui/useElapsed";
import { useDismiss } from "@/components/ui/useDismiss";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { useDraft } from "@/components/ui/useDraft";
import { AskBox, Rows, type Row } from "./Ask";
import { PropertyControl } from "./controls/PropertyControl";
import { isTyping } from "./keys";
import { Markdown } from "./Markdown";
import { MentionList, useMentions } from "./Mentions";
import { useBoard, usePresence } from "./store";
import boardStyles from "./board.module.css";
import styles from "./panel.module.css";

/** One person's answer about their own screen, kept in their own browser. */
const WIDTH_KEY = "ushabti:panel-width";

export function TaskPanel({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const {
    data,
    user,
    cardItems,
    setValue,
    patchTask,
    deleteTask,
    archiveTask,
    restoreTask,
    addOption,
    syncTaskCounts,
    controlRun,
    notify,
    refresh,
    wrote,
  } = useBoard();
  const { faces, inField, editing } = usePresence(taskId);
  /*
   * What the last read answered, and the task it was asked about. Only a
   * different task clears what is on screen, and holding the two together is
   * how: an answer about the task before this one simply does not match, so
   * there is nothing to reset afterwards. Nothing unmounts either, which is
   * what keeps the note somebody is part-way through writing in the comment
   * box when a new `load` arrives.
   */
  const [loaded, setLoaded] = useState<{ taskId: string; task: TaskDetailDTO | null } | null>(null);
  const detail = loaded?.taskId === taskId ? loaded.task : null;
  const [tab, setTab] = useState<"comments" | "activity" | "agent">("comments");
  const [menuOpen, setMenuOpen] = useState(false);
  /* Which list is taking a key, and on which task. A task with no links draws
     nothing here at all, so the way in is the menu — the panel stays as quiet
     at rest as it was before links existed.
     The task is held beside the answer rather than cleared in an effect: the
     panel does not unmount when somebody opens another task, and a box left
     open on the task before this one would be asking about nothing. */
  const [linking, setLinking] = useState<{ taskId: string; way: LinkWay } | null>(null);
  const addingLink = linking?.taskId === taskId ? linking.way : null;
  const menuRef = useDismiss<HTMLDivElement>(() => setMenuOpen(false), menuOpen);
  /*
   * An archived task has no card, and its panel still opens: a link and a
   * search hit both end here. The board carries every task either way — a card
   * in `tasks`, or the lighter row in `archived` that holds the key, the title
   * and the description.
   *
   * So the panel asks the board first and the answer it fetched second. The
   * board is the part the stream keeps fresh, which settles both halves of
   * this at once: the head is drawn before the first fetch lands, and a task
   * somebody else archives — or puts back — says so within a beat, without
   * waiting for a second read. The detail keeps what only it carries: the
   * values, the checklist, the comments, the activity and the run.
   *
   * The other reading was to reload the detail on every broadcast and go on
   * drawing the archived row from it. That leaves two answers to one question,
   * and the row then waits for a read that the rule below may drop.
   */
  const liveTask = data.tasks.find((t) => t.id === taskId) ?? null;
  const archivedRow = data.archived.find((t) => t.id === taskId) ?? null;

  /* A whole card-shaped task, for the things that need one. */
  const boardTask: TaskDTO | null = liveTask ?? detail;

  const shown = useMemo(() => {
    const row = liveTask ?? archivedRow ?? detail;
    if (!row) return null;
    return {
      key: row.key,
      title: row.title,
      description: row.description,
      /* An archived row carries no values. The detail does. */
      values: boardTask?.values ?? {},
      archivedAt: row.archivedAt ?? null,
    };
  }, [archivedRow, boardTask, detail, liveTask]);

  /* The clock the archived row reads. It ticks only while that row is drawn,
     so "just now" becomes "1 minute ago" without a reload and nothing else
     re-renders for it. */
  const now = useNow(!!shown?.archivedAt);

  /*
   * Every write this panel makes, counted, exactly as the board counts its own.
   * A read of the task that was already out when one went answers with the task
   * as it was before the write, and drawing that quietly undoes the comment
   * somebody just sent. Every change anybody makes starts such a read here.
   */
  const writes = useRef(0);

  /*
   * One rule, two subjects: the panel writes some things itself and hands the
   * rest to the store, and a read that went out before either of them is as
   * stale. So every write the panel starts is counted here, before it goes.
   *
   * The store keeps a count of its own, for its own read of the board. Two
   * counters for two reads is the smaller answer: one number would be bumped
   * by writes the other read cannot see, and a read dropped for a write that
   * did not touch it is a read lost for nothing.
   */
  const counted = useCallback(<T,>(write: () => Promise<T>): Promise<T> => {
    writes.current += 1;
    return write();
  }, []);

  /*
   * The task the last read was started for. The panel stays where it is when
   * somebody opens another task, so a slow read of the one before it is still
   * on its way when the new one lands. Its answer is about a task nobody is
   * looking at any more: put away, it leaves the panel with nothing to draw
   * and no reason to read again. The counter above cannot see this, because
   * opening another task is not a write.
   */
  const asked = useRef(taskId);

  /* The read is something outside React, so what comes back from it is put on
     screen in the promise’s own callback rather than in the line that started
     the read. The effect below only asks; this is where the answer lands. */
  const load = useCallback(() => {
    const at = writes.current;
    asked.current = taskId;
    return api
      .get<{ task: TaskDetailDTO | null }>(`/api/tasks/${taskId}`)
      .then((res) => {
        if (writes.current !== at || asked.current !== taskId) return;
        setLoaded({ taskId, task: res.task });
        if (!res.task) {
          onClose();
          return;
        }
        syncTaskCounts(taskId, {
          checklistTotal: res.task.checklist.length,
          checklistDone: res.task.checklist.filter((c) => c.done).length,
          commentCount: res.task.comments.length,
        });
      })
      .catch(() => {
        /* A read that was overtaken must not close the panel either: the task
           it failed on is not the one on screen. */
        if (asked.current !== taskId) return;
        onClose();
      });
  }, [onClose, syncTaskCounts, taskId]);

  /* A write of this panel’s own ends by reading the task again, so the read a
     broadcast started before it is dropped rather than landing on top of it. */
  const reload = useCallback(() => counted(load), [counted, load]);

  /* What the panel hands to the store is counted on the way out, as its own
     writes are.

     A field somebody typed in also sends the text it started from, and then
     the write goes straight to the route rather than through the store: the
     store turns every refusal into a toast, and a refused text save has to
     come back here, to the field, which asks in place what to do. The field
     keeps its words on screen until this answers, so nothing flickers back
     while the board is read again. */
  const patch = useCallback(
    async (
      fields: { title?: string; description?: string },
      base?: { title?: string; description?: string },
    ): Promise<Saved> => {
      if (!base) {
        await counted(() => patchTask(taskId, fields));
        return "saved";
      }
      /* The store counts it too. A board read that was out before this save
         would otherwise land after it and put the old words back on the card
         and in the field, and the next edit would start from them. */
      wrote();
      let answer: Saved = "saved";
      try {
        await counted(() =>
          api.patch(`/api/tasks/${taskId}`, {
            ...fields,
            baseTitle: base.title,
            baseDescription: base.description,
          }),
        );
      } catch (err) {
        answer = err instanceof ApiError && err.status === 409 ? "changed" : "failed";
        if (answer === "failed")
          notify(err instanceof Error ? err.message : "The change did not save.");
      }
      /* Either way the field needs the saved text: the new one to show, or the
         one somebody else wrote to show beside these words. */
      await Promise.all([reload(), refresh()]);
      return answer;
    },
    [counted, notify, patchTask, refresh, reload, taskId, wrote],
  );

  /* Who wrote a field last, if the feed says and it was not me. A checklist
     item has no line of its own, so only the title and the description ask. */
  const wroteLast = (kind: "title" | "description") => {
    const line = detail?.activity.find((entry) => entry.kind === kind);
    return line?.actor && line.actor.id !== user.id ? line.actor.name : null;
  };

  const makeOption = useCallback(
    (propertyId: string, name: string) => counted(() => addOption(propertyId, name)),
    [addOption, counted],
  );

  /*
   * The store draws a new value on the card at once. An archived task has no
   * card, and its values are drawn from this read, so the panel patches the
   * same answer here. Reading the task again instead would leave the old
   * value on screen for the whole round trip, which is the fault in miniature.
   */
  const writeValue = useCallback(
    async (propertyId: string, value: TaskValue) => {
      setLoaded((current) =>
        current?.taskId === taskId && current.task
          ? {
              ...current,
              task: { ...current.task, values: { ...current.task.values, [propertyId]: value } },
            }
          : current,
      );
      const saved = await counted(() => setValue(taskId, propertyId, value));
      /* The store puts the board right when a write is refused, and nothing
         puts this copy right. On an archived task it is the only copy, so the
         value the person sees is the one that was thrown away. */
      if (!saved) await reload();
    },
    [counted, reload, setValue, taskId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handler = () => void load();
    window.addEventListener("ushabti:remote-change", handler);
    return () => window.removeEventListener("ushabti:remote-change", handler);
  }, [load]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !isTyping(event.target)) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* The task key is its address: the panel writes the open task into the
     query, so the address bar already holds the link a person wants to paste
     into a chat. This copies that same shape from wherever the board is
     served, so a link made behind a proxy still points at the proxy. */
  const copyLink = useCallback(async () => {
    const link = `${window.location.origin}/p/${data.project.id}?task=${shown?.key ?? taskId}`;
    if (await copyText(link)) notify("Link copied", "info");
    else notify("The link did not copy. The address bar holds it.");
  }, [data.project.id, notify, shown, taskId]);

  /* The band takes the colour the card wears: its edge stripe, or the first
     colour the card view puts on it. The panel and the card it came from are
     one thing, so they read the same colour out of the same place. */
  const accent = useMemo(
    () => (boardTask ? cardAccent(cardItems, boardTask, data.members) : null) ?? "#3f4650",
    [boardTask, cardItems, data.members],
  );

  /* How wide the panel is lives on the element and never in state: a render
     for every pointer move would draw the comments, the description and the
     run log again, forty times a second. */
  const panelRef = useRef<HTMLElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);

  const widen = useCallback((px: number) => {
    const panel = panelRef.current;
    if (!panel) return 0;
    const width = clampPanelWidth(px, window.innerWidth);
    panel.style.setProperty("--panel-w", `${width}px`);
    gripRef.current?.setAttribute("aria-valuenow", String(width));
    /* The widest the window allows: asking for the window itself gets it. */
    gripRef.current?.setAttribute(
      "aria-valuemax",
      String(clampPanelWidth(window.innerWidth, window.innerWidth)),
    );
    return width;
  }, []);

  /* The width is one person's answer to their own screen, so it is kept in
     their browser and not on the board everybody shares. */
  const remember = useCallback((width: number) => {
    try {
      window.localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(WIDTH_KEY);
    } catch {
      /* private mode */
    }
    /* No answer means the width the stylesheet gives it, which still has to
       pass the window it opened in. */
    widen(Number(saved) || panel.getBoundingClientRect().width);

    const onResize = () => widen(panel.getBoundingClientRect().width);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [widen]);

  function onGripDown(event: React.PointerEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel || event.button !== 0) return;
    event.preventDefault();

    const grip = event.currentTarget;
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    grip.setPointerCapture(event.pointerId);
    grip.dataset.dragging = "true";
    /* A drag over the panel would otherwise select every word it crosses. */
    document.body.style.userSelect = "none";

    /* The panel grows to the left, so the pointer moving left widens it. */
    const move = (e: PointerEvent) => widen(startWidth + (startX - e.clientX));
    const done = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", done);
      grip.removeEventListener("pointercancel", done);
      delete grip.dataset.dragging;
      document.body.style.userSelect = "";
      remember(panel.getBoundingClientRect().width);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", done);
    grip.addEventListener("pointercancel", done);
  }

  /* The edge answers the arrow keys too, so the width is not a mouse-only
     setting. Shift takes the bigger step, as it does in every editor. */
  function onGripKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel) return;
    const way = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
    if (!way) return;
    event.preventDefault();
    const step = event.shiftKey ? 48 : 16;
    remember(widen(panel.getBoundingClientRect().width + way * step));
  }

  /*
   * The agent tab exists while a run does, and it stays for the record: a task
   * an agent worked on yesterday still answers "what did it do?". Deriving the
   * shown tab rather than resetting it in an effect keeps the choice in one
   * place.
   */
  const run = detail?.run ?? null;
  const pastRuns = detail?.pastRuns ?? [];
  const anyRun = run ?? pastRuns[0] ?? null;
  const shownTab = tab === "agent" && !anyRun ? "comments" : tab;

  /* The board knows every task this panel can be opened on, so there is
     nothing left to wait for before the head is drawn. */
  if (!shown) return null;

  return (
    <aside className={styles.panel} data-testid="task-panel" ref={panelRef}>
      {/* The panel is dragged wider by its own left edge. There is no handle
          to look at: the cursor over the line is the whole invitation. */}
      <div
        className={styles.grip}
        data-testid="panel-grip"
        ref={gripRef}
        role="separator"
        aria-orientation="vertical"
        aria-label="Panel width"
        aria-valuemin={PANEL_MIN_WIDTH}
        tabIndex={0}
        onPointerDown={onGripDown}
        onKeyDown={onGripKey}
      />

      <div className={styles.accent} data-testid="panel-accent" style={{ background: accent }} />

      {/* One row, at the top, on an archived task. It says how long ago and
          offers the way back; nothing else about the panel changes, because an
          archived task is a whole task that no view is drawing. */}
      {shown.archivedAt && (
        <div className={styles.archivedRow} data-testid="archived-row">
          {/* The words come from a clock, and the server reads its clock a
              moment before the browser reads its own. React is told so, rather
              than being left to find the two texts disagree on a boundary. */}
          <span suppressHydrationWarning>Archived {longAgo(shown.archivedAt, now)}</span>
          <span className={styles.archivedSep}>·</span>
          <button
            className={styles.archivedBack}
            onClick={async () => {
              await restoreTask(taskId);
              /* The task's own history gained a line, and this panel is the
                 thing showing it. */
              await reload();
            }}
          >
            Put it back
          </button>
        </div>
      )}

      <div className={styles.head} style={{ background: tint(accent, 0.06) }} ref={menuRef}>
        <div className={styles.headRow}>
          <button
            type="button"
            className={styles.key}
            data-testid="task-key"
            title="Copy link to this task"
            aria-label={`Copy link to ${shown.key}`}
            onClick={() => void copyLink()}
          >
            {shown.key}
          </button>
          <span style={{ flex: 1 }} />
          {/* Who else has this task open. Fields save on blur and the last
              write wins, so seeing somebody here is the warning. The tip is
              the one the listening agents wear: a title never shows on focus. */}
          {faces.length > 0 && (
            <span className={boardStyles.listening} data-testid="panel-present">
              {faces.map((person) => (
                <span
                  key={person.id}
                  className={boardStyles.listener}
                  data-testid="panel-present-face"
                  data-name={person.name}
                  role="img"
                  aria-label={`${person.name} has this task open`}
                  tabIndex={0}
                >
                  <Avatar name={person.name} color={person.color} size={20} title={null} />
                  <span className={boardStyles.listenerTip} aria-hidden="true">
                    <span className={boardStyles.listenerName}>{person.name}</span>
                    <span>Has this task open.</span>
                  </span>
                </span>
              ))}
            </span>
          )}
          <button
            className={styles.iconButton}
            aria-label="Task menu"
            title="More"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          <button
            className={styles.iconButton}
            aria-label="Close task"
            title="Close (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
          {menuOpen && (
            <div className={styles.menu}>
              <button
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  void copyLink();
                }}
              >
                <span className={styles.menuDot} />
                Copy link
              </button>
              <button
                className={styles.menuItem}
                data-testid="add-blocker"
                onClick={() => {
                  setMenuOpen(false);
                  setLinking({ taskId, way: "blockedBy" });
                }}
              >
                <span className={styles.menuDot} />
                Blocked by…
              </button>
              {/* Archive is the everyday way to make a task go away: the
                  panel stays open on the row that puts it back. Delete is for
                  a mistake, and it is still the one that ends things. */}
              {!shown.archivedAt && (
                <button
                  className={styles.menuItem}
                  data-testid="archive-task"
                  onClick={async () => {
                    setMenuOpen(false);
                    await archiveTask(taskId);
                    await reload();
                  }}
                >
                  <span className={styles.menuDot} />
                  Archive task
                </button>
              )}
              <button
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  setMenuOpen(false);
                  onClose();
                  void deleteTask(taskId);
                }}
              >
                <span className={styles.menuDot} />
                Delete task
              </button>
            </div>
          )}
        </div>

        <TitleField
          taskId={taskId}
          value={shown.title}
          changedBy={wroteLast("title")}
          sign={editingSaid(editing("title"), "the title")}
          inField={inField}
          onCommit={(title, base) => patch({ title }, { title: base })}
        />
      </div>

      <div className={styles.body}>
        {/* Everything below the head is the answer this panel fetched. An
            archived task has no card to draw it from, so while that answer is
            out the panel says so — an empty Priority on a task that has one
            would be an answer nobody asked for. */}
        {!boardTask ? (
          <div className={styles.loading} data-testid="panel-loading">
            Loading…
          </div>
        ) : (
          <>
            <div className={styles.props}>
              {data.properties.map((property, index) => (
                <div key={property.id} style={{ display: "contents" }}>
                  <div className={`${styles.propLabel} ${index > 0 ? styles.rowLine : ""}`}>
                    {property.name}
                  </div>
                  {/* The row is a grid of two cells, so the value carries the
                  name a test needs to reach it by. */}
                  <div
                    className={`${styles.propValue} ${index > 0 ? styles.rowLine : ""}`}
                    data-property={property.name}
                  >
                    <PropertyControl
                      property={property}
                      value={shown.values[property.id] ?? null}
                      members={data.members}
                      onChange={(value: TaskValue) => void writeValue(property.id, value)}
                      onAddOption={
                        property.type === "select" || property.type === "multi_select"
                          ? (name) => makeOption(property.id, name)
                          : undefined
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.section}>
              {/* Its own state — what is typed, and the line a refusal
                  left — belongs to one task, so the key throws it away when
                  another one opens. */}
              <Links
                key={taskId}
                taskId={taskId}
                links={detail?.links ?? null}
                adding={addingLink}
                setAdding={(way) => setLinking(way ? { taskId, way } : null)}
                reload={reload}
                onError={notify}
              />

              <Description
                taskId={taskId}
                value={shown.description}
                changedBy={wroteLast("description")}
                sign={editingSaid(editing("description"), "the description")}
                inField={inField}
                onCommit={(description, base) => patch({ description }, { description: base })}
              />

              <Checklist
                taskId={taskId}
                items={detail?.checklist ?? []}
                loading={!detail}
                reload={reload}
                onError={notify}
                signOf={(itemId) => editingSaid(editing(checklistField(itemId)), "this item")}
                inField={inField}
              />
            </div>

            <div className={styles.tabs}>
              <button
                className={`${styles.tab} ${shownTab === "comments" ? styles.tabOn : ""}`}
                onClick={() => setTab("comments")}
              >
                Comments {detail ? detail.comments.length : ""}
              </button>
              <button
                className={`${styles.tab} ${shownTab === "activity" ? styles.tabOn : ""}`}
                onClick={() => setTab("activity")}
              >
                Activity
              </button>
              {/* No count on the label. The tab opens; the list is the
                  count. The dot pulses only while an agent is working. */}
              {anyRun && (
                <button
                  className={`${styles.tab} ${shownTab === "agent" ? styles.tabOn : ""}`}
                  onClick={() => setTab("agent")}
                  data-testid="agent-tab"
                >
                  <span
                    className={`${styles.tabDot} ${run?.status === "running" ? styles.tabDotLive : ""}`}
                    style={{ background: anyRun.agent.color }}
                  />
                  Agent
                </button>
              )}
            </div>

            {!detail && <div className={styles.loading}>Loading…</div>}

            {detail && shownTab === "comments" && (
              <Comments
                taskId={taskId}
                detail={detail}
                me={user}
                description={shown.description}
                onUseAsDescription={(description) => patch({ description })}
                reload={reload}
                onError={notify}
              />
            )}

            {detail && shownTab === "activity" && (
              <div className={styles.feed}>
                {detail.activity.length === 0 && (
                  <div className={styles.activityRow}>
                    <span className={styles.activityTime}>—</span>
                    <span className={styles.activityText}>Nothing has happened yet.</span>
                  </div>
                )}
                {detail.activity.map((entry) => (
                  <div key={entry.id} className={styles.activityRow}>
                    <span className={styles.activityTime}>{relativeTime(entry.createdAt)}</span>
                    <span className={styles.activityText}>{describeActivity(entry)}</span>
                  </div>
                ))}
              </div>
            )}

            {shownTab === "agent" && (
              <>
                {run && (
                  <AgentRunBlock
                    run={run}
                    onControl={async (control) => {
                      await controlRun(run.id, control);
                      await reload();
                    }}
                  />
                )}
                {pastRuns.length > 0 && <PastRuns runs={pastRuns} />}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* What a task waits on                                                 */
/* ------------------------------------------------------------------ */

/** The two ends of the chain. `blockedBy` is what this task waits on. */
type LinkWay = "blockedBy" | "blocks";

const LINK_WORDS: Record<LinkWay, { head: string; add: string; ask: string; empty: string }> = {
  blockedBy: {
    head: "Blocked by",
    add: "Add a task this one waits on",
    ask: "Which task blocks this one?",
    empty: "No task by that name.",
  },
  blocks: {
    head: "Blocks",
    add: "Add a task that waits on this one",
    ask: "Which task waits on this one?",
    empty: "No task by that name.",
  },
};

/**
 * The two short lists: what this task waits on, and what waits on it.
 *
 * A link is not a property and not a row of the card view, so it is not in the
 * grid above. It sits between the properties and the description because that
 * is where "why is this not moving" belongs.
 *
 * A task with no links draws nothing at all. The way in is the task menu, so
 * the panel at rest reads exactly as it did before links existed — a heading
 * over an empty list on every task in the project would be a worse trade than
 * one more line in a menu nobody opens by accident.
 *
 * The ✕ asks nothing. Unlinking costs one key to undo, and `ConfirmRow` is
 * for what cannot be undone.
 */
function Links({
  taskId,
  links,
  adding,
  setAdding,
  reload,
  onError,
}: {
  taskId: string;
  links: { blockedBy: TaskLinkDTO[]; blocks: TaskLinkDTO[] } | null;
  adding: LinkWay | null;
  setAdding: (way: LinkWay | null) => void;
  reload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { data, linkBlocker } = useBoard();
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  /** The sentence a refused link came back with — a circle, or itself. */
  const [refused, setRefused] = useState<string | null>(null);

  /* Every task in the project, archived ones too, exactly as the search box
     reads them: a task off the board can still be what this one waits on. */
  const taken = useMemo(() => {
    const ids = new Set<string>([taskId]);
    for (const row of links?.blockedBy ?? []) ids.add(row.id);
    for (const row of links?.blocks ?? []) ids.add(row.id);
    return ids;
  }, [links, taskId]);

  const rows: Row[] = useMemo(() => {
    if (!adding) return [];
    return searchTasks([...data.tasks, ...data.archived], query)
      .filter((hit) => !taken.has(hit.task.id))
      .map((hit) => ({
        id: hit.task.id,
        name: `${hit.task.key}  ${hit.task.title}`,
        color: "#6b7280",
        note: hit.task.archivedAt ? "archived" : undefined,
      }));
  }, [adding, data.archived, data.tasks, query, taken]);

  /* One route writes both lists: which end of it this task is on is the only
     difference between them. */
  const ends = (way: LinkWay, other: string) =>
    way === "blockedBy" ? { to: taskId, from: other } : { to: other, from: taskId };

  /* Both go through the store, which counts the write before it sends it: a
     read of the board that was already out would otherwise land on top of it
     and take the chain glyph off again. The card comes off the board and the
     lists off this read, so both are asked for. */
  async function add(way: LinkWay, other: string) {
    const { to, from } = ends(way, other);
    try {
      await linkBlocker(to, from, true);
      setQuery("");
      setRefused(null);
      setAdding(null);
      await reload();
    } catch (err) {
      /* A circle is answered in the row somebody is looking at, never in a
         toast: the sentence says what to do instead. */
      setRefused(err instanceof Error ? err.message : "That link did not save.");
    }
  }

  async function remove(way: LinkWay, other: string) {
    const { to, from } = ends(way, other);
    try {
      await linkBlocker(to, from, false);
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "That link did not go.");
    }
  }

  const lists: LinkWay[] = ["blockedBy", "blocks"];
  const anything = lists.some((way) => (links?.[way] ?? []).length > 0);
  if (!anything && !adding) return null;

  return (
    <div className={styles.block} data-testid="task-links">
      {lists.map((way) => {
        const list = links?.[way] ?? [];
        if (list.length === 0 && adding !== way) return null;
        const words = LINK_WORDS[way];
        const listId = `task-links-${way}`;

        return (
          <div key={way} className={styles.block} data-testid={`links-${way}`}>
            <div className={styles.blockHead}>
              <span className="label">{words.head}</span>
              <span style={{ flex: 1 }} />
              <button
                className={styles.linkAdd}
                aria-label={words.add}
                title={words.add}
                onClick={() => {
                  setQuery("");
                  setRefused(null);
                  setAdding(adding === way ? null : way);
                }}
              >
                +
              </button>
            </div>

            {list.map((row) => (
              <div key={row.id} className={styles.linkRow} data-testid="link-row">
                <span className={`${styles.linkKey} mono`}>{row.key}</span>
                {/* A blocker that is over blocks nothing any more, and it is
                    still here: struck through says both at once. */}
                <span className={`${styles.linkTitle} ${row.over ? styles.linkOver : ""}`}>
                  {row.title}
                </span>
                <button
                  className={styles.linkRemove}
                  aria-label={`Unlink ${row.key}`}
                  title="Unlink"
                  onClick={() => void remove(way, row.id)}
                >
                  ✕
                </button>
              </div>
            ))}

            {adding === way && (
              <>
                <AskBox
                  query={query}
                  onQuery={(value) => {
                    setQuery(value);
                    /* Looking for another task is the answer to the line. */
                    setRefused(null);
                  }}
                  rows={rows}
                  at={at}
                  setAt={setAt}
                  onPick={(row) => void add(way, row.id)}
                  listId={listId}
                  label={words.ask}
                  placeholder={words.ask}
                  testId={`link-search-${way}`}
                />
                {refused && (
                  <span className={styles.linkRefused} role="status" data-testid="link-refused">
                    {refused}
                  </span>
                )}
                <Rows
                  rows={rows}
                  at={at}
                  listId={listId}
                  empty={words.empty}
                  onPick={(row) => void add(way, row.id)}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function describeActivity(entry: {
  kind: string;
  data: Record<string, unknown>;
  actor: { name: string } | null;
}): string {
  const who = entry.actor?.name ?? "Someone";
  const d = entry.data as {
    property?: string;
    value?: string;
    title?: string;
    text?: string;
    action?: string;
    by?: string;
    forName?: string;
    to?: string;
    blockerKey?: string;
    source?: string;
  };
  switch (entry.kind) {
    case "created":
      return `${who} created the task`;
    case "title":
      return `${who} renamed it to “${d.title ?? ""}”`;
    case "description":
      return `${who} edited the description`;
    case "value":
      return `${who} set ${d.property ?? "a property"} to ${d.value ?? "empty"}`;
    case "checklist":
      return `${who} ${d.action ?? "changed"} “${d.text ?? ""}”`;
    case "comment":
      return `${who} left a comment`;
    case "archive":
      return d.action === "restored" ? `${who} put the task back` : `${who} archived the task`;
    case "import":
      /* One import writes a line on the project with the counts and one on
         every task it made. Only a task's lines reach this panel. */
      return `${who} brought this in from ${d.source === "trello" ? "Trello" : "another board"}`;
    case "link":
      return d.action === "unlinked"
        ? `${who} stopped it waiting on ${d.blockerKey || "another task"}`
        : `${who} made it wait on ${d.blockerKey || "another task"}`;
    case "run": {
      // A hand-over is the one run line that names somebody else.
      if (d.action === "handed_over") return `${who} handed the task to ${d.to || "somebody else"}`;
      // `lost` is the one word two things write, so the line asks for the
      // author first and falls back to the word alone for a line written
      // before the author was on it.
      const word = RUN_WORDS[`${d.action}:${d.by}`] ?? RUN_WORDS[d.action ?? ""];
      return `${who} ${word ?? "changed the run"}`;
    }
    // A line on the project, not on a task. No screen draws one yet.
    case "reset":
      return `${who} made a reset link for ${d.forName ?? "somebody"}`;
    default:
      return `${who} made a change`;
  }
}

const RUN_WORDS: Record<string, string> = {
  started: "started a run",
  done: "finished the run",
  failed: "stopped with a failure",
  stopped: "stopped the run",
  taken_over: "took the task over",
  /* `lost` says two things: the board closed a run nobody answered for, or an
     agent said goodbye as its session ended. `lostBy` decides which when the
     line is written, and the two read nothing alike. */
  lost: "stopped answering, so the board closed the run",
  "lost:lease": "stopped answering, so the board closed the run",
  "lost:agent": "shut down, and the run ended with it",
};

/**
 * The run block of the design: what the agent does now, the plan behind it and
 * the log under that. The buttons ask; only Take over decides.
 */
function AgentRunBlock({
  run,
  onControl,
}: {
  run: AgentRunDetailDTO;
  onControl: (control: RunControl | "take_over") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const now = useNow(isOpen(run.status));
  const since = elapsed(run.startedAt, now);
  const life = lifeOf(run, now);
  const paused = run.status === "paused";
  // Both waiting runs stopped on purpose, so neither has anything to pause or
  // stop. Only the note below tells the two apart, because only the words do.
  const waiting = isWaiting(run.status);
  const handedOver = run.status === "handed_over";

  async function press(control: RunControl | "take_over") {
    if (busy) return;
    setBusy(true);
    try {
      await onControl(control);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.run} data-testid="panel-run">
      <div className={styles.runHead}>
        <Avatar
          name={run.agent.name}
          color={run.agent.color}
          size={18}
          kind="agent"
          live={run.status === "running" && life === "reporting"}
        />
        <span className={styles.runAgent}>{run.agent.name}</span>
        <span className={styles.runState}>
          {life === "reporting" ? STATUS_WORD[run.status] : LIFE_WORD[life]}
        </span>
        <span style={{ flex: 1 }} />
        <span className={styles.runSince}>started {since} ago</span>
      </div>

      <div className={styles.runNow}>
        <span
          className={`${styles.runNowDot} ${paused || waiting ? styles.runNowDotPaused : ""}`}
          style={{ background: run.agent.color }}
        />
        <span className={styles.runNowText}>{runLine(run)}</span>
        {run.stepsTotal > 0 && (
          <span className={styles.runCount}>
            {Math.min(run.stepsDone + 1, run.stepsTotal)} / {run.stepsTotal}
          </span>
        )}
      </div>

      {run.stepsTotal > 0 && (
        <>
          <span className={styles.runBar}>
            <span
              className={styles.runBarFill}
              style={{ width: `${progressOf(run) * 100}%`, background: run.agent.color }}
            />
          </span>
          <RunPlan steps={run.steps} color={run.agent.color} since={since} />
        </>
      )}

      <RunLog log={run.log} />

      {handedOver ? (
        <div className={styles.runNote} data-testid="panel-run-handed-over">
          {run.agent.name} handed the task to {run.step.trim() || "the next agent"} and stopped. The
          next agent that claims the task finishes this run and starts its own. Nothing runs until
          then, so there is nothing to pause or stop.
        </div>
      ) : waiting ? (
        <div className={styles.runNote} data-testid="panel-run-waiting">
          {run.agent.name} asked a question and stopped. Answer it in a comment, and it picks the
          task up again. Nothing runs until then, so there is nothing to pause or stop.
        </div>
      ) : (
        <div className={styles.runNote}>
          Your edits still save while the agent works. Take over ends the run and gives you the
          card.
        </div>
      )}

      <div className={styles.runButtons}>
        {waiting ? null : paused ? (
          <button className={styles.runButton} disabled={busy} onClick={() => void press("resume")}>
            Resume
          </button>
        ) : (
          <button className={styles.runButton} disabled={busy} onClick={() => void press("pause")}>
            Pause
          </button>
        )}
        {!waiting && (
          <button className={styles.runButton} disabled={busy} onClick={() => void press("stop")}>
            Stop
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          className={styles.runTakeOver}
          disabled={busy}
          onClick={() => void press("take_over")}
        >
          Take over
        </button>
      </div>
      {run.control && (
        <div className={styles.runNote} data-testid="panel-run-pending">
          Asked the agent to {run.control}. It answers on its next report.
        </div>
      )}
      {life !== "reporting" && (
        <div className={styles.runNote} data-testid="panel-run-quiet">
          {life === "silent"
            ? `Nothing from ${run.agent.name} for ${elapsed(run.updatedAt, now)}.`
            : `${run.agent.name} is alive but has reported nothing for ${elapsed(run.updatedAt, now)}.`}{" "}
          The board closes this run in {duration(leaseLeft(run, now))}, and the task goes back to
          whoever wants it.
        </div>
      )}
    </div>
  );
}

/**
 * The plan of a run. A live run says how long it has been on the step it is
 * on; a run that is over says nothing there, because nothing is moving.
 */
function RunPlan({
  steps,
  color,
  since,
}: {
  steps: AgentRunStepDTO[];
  color: string;
  since?: string;
}) {
  return (
    <div className={styles.runPlan} data-testid="panel-run-plan">
      {steps.map((step) => (
        <div key={step.id} className={styles.runStep}>
          <span
            className={`${styles.runStepBox} ${
              step.state === "done"
                ? styles.runStepDone
                : step.state === "active"
                  ? `${styles.runStepActive} ${since ? "" : styles.runStepStill}`
                  : ""
            }`}
            style={step.state === "done" ? { background: color } : undefined}
          />
          <span
            className={`${styles.runStepText} ${step.state === "done" ? styles.runStepStruck : ""}`}
          >
            {step.text}
          </span>
          {step.state === "active" && since && <span className={styles.runSince}>{since}</span>}
        </div>
      ))}
    </div>
  );
}

/** The log of a run, as it was written. */
function RunLog({ log }: { log: AgentRunLogDTO[] }) {
  if (log.length === 0) return null;
  return (
    <div className={styles.runLog} data-testid="panel-run-log">
      {log.map((line) => (
        <div key={line.id} className={styles.runLogRow}>
          <span className={styles.runLogTime}>{relativeTime(line.createdAt)}</span>
          <span className={styles.runLogText}>{line.text}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The runs that are over, newest first.
 *
 * A row is a record and reads like one: who, when, how long, how it ended and
 * what it set out to do. A failed run gets no colour of its own — the strip on
 * a card uses colour to say something is alive now, and a record in red would
 * shout about yesterday. Pressing a row opens the plan and the log as they
 * were left, one row at a time, because two open rows are a list nobody can
 * read.
 */
function PastRuns({ runs }: { runs: AgentRunRowDTO[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  /* What the opened rows answered. A run that is over never changes, so it is
     read once and kept for as long as the panel is on this task. */
  const [seen, setSeen] = useState<Record<string, AgentRunDetailDTO>>({});
  const [failed, setFailed] = useState<string | null>(null);

  async function press(runId: string) {
    if (openId === runId) {
      setOpenId(null);
      return;
    }
    setOpenId(runId);
    setFailed(null);
    if (seen[runId]) return;
    try {
      const res = await api.get<{ run: AgentRunDetailDTO }>(`/api/runs/${runId}`);
      setSeen((current) => ({ ...current, [runId]: res.run }));
    } catch {
      setFailed(runId);
    }
  }

  return (
    <div className={styles.past} data-testid="panel-past-runs">
      <span className="label">Earlier runs</span>
      {runs.map((run) => {
        const words = pastRunWords(run);
        const open = openId === run.id;
        const detail = seen[run.id];
        return (
          <div key={run.id} className={styles.pastItem}>
            <button
              className={styles.pastRow}
              data-testid="past-run"
              aria-expanded={open}
              onClick={() => void press(run.id)}
            >
              <Avatar name={run.agent.name} color={run.agent.color} size={16} kind="agent" />
              <span className={styles.pastAgent}>{run.agent.name}</span>
              <span className={styles.pastDot}>·</span>
              <span className={styles.pastWhen}>{words.when}</span>
              <span className={styles.pastDot}>·</span>
              <span className={styles.pastWhen}>{words.length}</span>
              <span className={styles.pastDot}>·</span>
              <span className={styles.pastEnded}>{words.ended}</span>
              {/* The goal takes the rest of the line, and a line of its own
                  on a screen too narrow to hold both. */}
              <span className={styles.pastGoal}>{run.goal}</span>
            </button>
            {open && (
              <div className={styles.pastOpen} data-testid="past-run-open">
                {detail ? (
                  <>
                    {detail.steps.length > 0 && (
                      <RunPlan steps={detail.steps} color={run.agent.color} />
                    )}
                    <RunLog log={detail.log} />
                    {detail.steps.length === 0 && detail.log.length === 0 && (
                      <span className={styles.runNote}>This run left no plan and no log.</span>
                    )}
                  </>
                ) : (
                  <span className={styles.runNote}>
                    {failed === run.id ? "That run did not load." : "Loading…"}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What a text save comes back with. `changed` means somebody else wrote the
 * field after this tab started typing, so nothing was written.
 */
type Saved = "saved" | "changed" | "failed";

/**
 * A text save that was refused, asked in place. The field turns into the
 * question the way a row does in `ConfirmRow`: the board has no dialogs, and
 * the answer belongs where the words are. It shows the saved text above the
 * words that were not saved, so the choice is made with both in view.
 *
 * The saved text is read live. If a third change lands while this is open,
 * the text above moves with it, and **Keep mine** sends against that one.
 */
function ChangedWhileTyping({
  theirs,
  mine,
  by,
  onKeep,
  onTake,
}: {
  theirs: string;
  mine: string;
  by: string | null;
  onKeep: () => void;
  onTake: () => void;
}) {
  return (
    <div
      className={styles.changed}
      role="group"
      aria-label="This changed while you typed"
      data-testid="changed-while-typing"
    >
      <span className={styles.changedSay}>
        This changed while you typed{by ? `. ${by} saved it first` : ""}.
      </span>
      <span className={styles.changedLabel}>Saved</span>
      <div className={styles.changedText} data-testid="changed-theirs">
        {theirs || "Nothing"}
      </div>
      <span className={styles.changedLabel}>Yours</span>
      <div className={styles.changedText} data-testid="changed-mine">
        {mine || "Nothing"}
      </div>
      <div className={styles.changedActions}>
        <Button autoFocus onClick={onKeep}>
          Keep mine
        </Button>
        <Button variant="ghost" onClick={onTake}>
          Take theirs
        </Button>
      </div>
    </div>
  );
}

/**
 * Says which field this tab is typing in while `field` is set, and that it
 * left when it is not. The cleanup is what covers a box that closes without a
 * blur, as the description does on Escape.
 */
function useSayField(field: string | null, inField: (field: string | null) => void) {
  useEffect(() => {
    if (!field) return;
    inField(field);
    return () => inField(null);
  }, [field, inField]);
}

/**
 * Who else is typing in this field. Words only, in the same place under every
 * kind of field, and nothing is disabled: the save guard answers the rare
 * case where both save.
 */
function EditingSign({ said, item = false }: { said: string | null; item?: boolean }) {
  if (!said) return null;
  return (
    <div
      className={`${styles.editing} ${item ? styles.editingItem : ""}`}
      data-testid="editing-sign"
      role="status"
    >
      {said}
    </div>
  );
}

function TitleField({
  taskId,
  value,
  changedBy,
  sign,
  inField,
  onCommit,
}: {
  taskId: string;
  value: string;
  changedBy: string | null;
  sign: string | null;
  inField: (field: string | null) => void;
  onCommit: (text: string, base: string) => Promise<Saved>;
}) {
  const [focused, setFocused] = useState(false);
  useSayField(focused ? "title" : null, inField);
  const [draft, setDraft] = useState(value);
  /* Whether this tab typed in the box since its last save. A click is not an
     edit: the draft it leaves behind goes stale the moment an agent or
     another person renames the task, and writing it back would undo them. */
  const [typed, setTyped] = useState(false);
  /* The title the typing started from. The save sends it, and the server
     writes only if the title still says it. */
  const base = useRef(value);
  /* The words on their way, shown until the answer lands, so the old title
     does not come back for the length of one round trip. */
  const [sending, setSending] = useState<string | null>(null);
  /* Words the server refused because the title changed under them. */
  const [mine, setMine] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  function startTyping() {
    if (!typed) base.current = sending ?? value;
    setTyped(true);
  }

  /* A name picked from the list is typing, so the words are kept and the blur
     — or the closed tab — saves them like any other edit. */
  const picker = useMentions(ref, (text) => {
    setDraft(text);
    startTyping();
  });

  /* Escape blurs the field, and the blur is what saves. The draft is state, so
     it still holds the thrown-away words while that blur runs; a ref changes
     at once, so the blur reads this instead. Focusing the field again clears
     it. */
  const thrown = useRef(false);

  /* The field shows what the task says, and the draft only while somebody is
     writing in it. A title another person changed is therefore on screen at
     once, even under a cursor that typed nothing, and never has to be copied
     into the draft afterwards. */
  const text = typed ? draft : (sending ?? value);

  /* The words that still need a save: trimmed, and different both from what
     the typing started from and from what the title says now. */
  function unsaved() {
    const edit = editedText(draft, value);
    return edit && edit !== base.current ? edit : null;
  }

  async function save(edit: string, from: string) {
    setSending(edit);
    const answer = await onCommit(edit, from);
    setSending(null);
    if (answer === "changed") setMine(edit);
  }

  /* The blur that saves this field never comes when the tab is closed on it,
     so the same words go out on the way off the page. Escape throws them
     away, and a box nobody typed in has nothing to send. It carries the base
     too. A refusal then cannot be shown, because the tab is gone, and that is
     accepted: whoever saved first keeps their words. */
  useSaveOnLeave(() => {
    if (!typed || thrown.current) return null;
    const edit = unsaved();
    return edit
      ? {
          method: "PATCH",
          url: `/api/tasks/${taskId}`,
          body: { title: edit, baseTitle: base.current },
        }
      : null;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, mine]);

  if (mine !== null)
    return (
      <>
        <ChangedWhileTyping
          theirs={value}
          mine={mine}
          by={changedBy}
          onKeep={() => {
            setMine(null);
            void save(mine, value);
          }}
          onTake={() => setMine(null)}
        />
        <EditingSign said={sign} />
      </>
    );

  return (
    <>
      <textarea
        ref={ref}
        className={styles.title}
        data-testid="task-title"
        value={text}
        rows={1}
        onFocus={() => {
          thrown.current = false;
          setFocused(true);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          startTyping();
          picker.sync();
        }}
        onSelect={picker.sync}
        onBlur={() => {
          picker.close();
          setFocused(false);
          setTyped(false);
          if (!typed || thrown.current) return;
          const edit = unsaved();
          if (edit) void save(edit, base.current);
        }}
        onKeyDown={(e) => {
          /* The list has the keys while it is open: Enter picks a name and
             Escape closes the list, rather than saving or throwing away. */
          if (picker.onKeyDown(e)) return;
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
          if (e.key === "Escape") {
            thrown.current = true;
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
      <MentionList picker={picker} />
      <EditingSign said={sign} />
    </>
  );
}

function Description({
  taskId,
  value,
  changedBy,
  sign,
  inField,
  onCommit,
}: {
  taskId: string;
  value: string;
  changedBy: string | null;
  sign: string | null;
  inField: (field: string | null) => void;
  onCommit: (text: string, base: string) => Promise<Saved>;
}) {
  const [editing, setEditing] = useState(false);
  /* Open is editing, whether or not a key was pressed: the sign is there so
     that two people do not start at once. */
  useSayField(editing ? "description" : null, inField);
  const [draft, setDraft] = useState(value);
  /* Whether this tab typed since the editor opened. Opening it is not an
     edit, and the draft it leaves behind goes stale the moment somebody else
     writes the description. */
  const [typed, setTyped] = useState(false);
  /* The description the typing started from, as in the title. */
  const base = useRef(value);
  /* The words on their way, drawn until the answer lands. */
  const [sending, setSending] = useState<string | null>(null);
  /* Words the server refused because the description changed under them. */
  const [mine, setMine] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const shown = sending ?? value;

  function startTyping() {
    if (!typed) base.current = shown;
    setTyped(true);
  }

  /* A name picked from the list is typing, as it is in the title. */
  const picker = useMentions(ref, (text) => {
    setDraft(text);
    startTyping();
  });

  /* The editor shows what the task says until somebody types, so a
     description another person wrote is on screen at once. */
  const text = typed ? draft : shown;

  /* An empty description is an answer here, so this asks whether the words
     changed rather than whether there are any. */
  const owes = typed && draft !== value && draft !== base.current;

  async function save(words: string, from: string) {
    setSending(words);
    const answer = await onCommit(words, from);
    setSending(null);
    if (answer === "changed") setMine(words);
  }

  /* The same missing blur as the title, with the same base, and the same
     refusal nobody is left to see. */
  useSaveOnLeave(() =>
    owes
      ? {
          method: "PATCH",
          url: `/api/tasks/${taskId}`,
          body: { description: draft, baseDescription: base.current },
        }
      : null,
  );

  /* Nothing reads the draft until the editor opens, so the click that opens it
     is what fills it in. */
  function edit() {
    setDraft(shown);
    setTyped(false);
    setEditing(true);
  }

  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <span className="label">Description</span>
        <span style={{ flex: 1 }} />
        <span className={styles.hint}>
          <span className={styles.kbd}>MD</span>
          {editing ? "Cmd + Enter saves" : "click to edit"}
        </span>
      </div>
      {mine !== null ? (
        <ChangedWhileTyping
          theirs={value}
          mine={mine}
          by={changedBy}
          onKeep={() => {
            setMine(null);
            void save(mine, value);
          }}
          onTake={() => setMine(null)}
        />
      ) : editing ? (
        <>
          <textarea
            ref={ref}
            className={styles.descEditor}
            autoFocus
            value={text}
            placeholder="Write in markdown…"
            onChange={(e) => {
              setDraft(e.target.value);
              startTyping();
              picker.sync();
            }}
            onSelect={picker.sync}
            onBlur={() => {
              picker.close();
              setEditing(false);
              setTyped(false);
              if (owes) void save(draft, base.current);
            }}
            onKeyDown={(e) => {
              /* The list has the keys while it is open, so Escape closes it
                 and leaves the editor and the words alone. */
              if (picker.onKeyDown(e)) return;
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
              if (e.key === "Escape") {
                // No blur() here: closing the editor unmounts the textarea, and
                // a removed element raises no blur, so nothing is saved. A
                // blur() would save the draft first, which is the title's bug.
                setDraft(value);
                setTyped(false);
                setEditing(false);
              }
            }}
          />
          <MentionList picker={picker} />
        </>
      ) : (
        <div
          className={styles.desc}
          onClick={edit}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && edit()}
        >
          {shown.trim() ? <Markdown text={shown} /> : "Add a description…"}
        </div>
      )}
      <EditingSign said={sign} />
    </div>
  );
}

function Checklist({
  taskId,
  items,
  loading,
  reload,
  onError,
  signOf,
  inField,
}: {
  taskId: string;
  items: ChecklistItemDTO[];
  loading: boolean;
  reload: () => Promise<void>;
  onError: (message: string) => void;
  signOf: (itemId: string) => string | null;
  inField: (field: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  useSayField(editingId ? checklistField(editingId) : null, inField);
  const editBox = useRef<HTMLInputElement>(null);
  /* Only what this tab typed may be written back, as everywhere else. */
  const [typed, setTyped] = useState(false);
  /* The words the open box started from. The box holds its own words and
     does not follow a change that lands while it is open, so the base is what
     it opened with rather than what the item says when the typing starts. */
  const base = useRef("");
  /* Words the server refused because the item changed under them. There is
     no feed line for an item's words, so the question names nobody. */
  const [changed, setChanged] = useState<{ id: string; mine: string } | null>(null);

  /* One item is edited at a time, so opening or closing a box starts the
     question again. */
  function editItem(item: ChecklistItemDTO | null) {
    setEditingId(item?.id ?? null);
    setTyped(false);
    if (item) {
      base.current = item.text;
      setChanged(null);
    }
  }
  /* A box ticks before the server answers. The change is kept beside the list
     it was made on, so the next read of the task replaces both at once: a list
     that came back is never drawn under a tick it already carries. */
  const [edited, setEdited] = useState<{
    of: ChecklistItemDTO[];
    list: ChecklistItemDTO[];
  } | null>(null);
  const local = edited?.of === items ? edited.list : items;

  const change = useCallback(
    (next: (list: ChecklistItemDTO[]) => ChecklistItemDTO[]) => {
      setEdited((current) => ({
        of: items,
        list: next(current?.of === items ? current.list : items),
      }));
    },
    [items],
  );

  const done = local.filter((i) => i.done).length;

  /* One item is edited at a time, and its box holds its own words, so the
     leave reads that box. An emptied box deletes the item on blur; leaving
     the page must not, because a delete is not a save. */
  useSaveOnLeave(() => {
    const item = local.find((i) => i.id === editingId);
    if (!item || !typed) return null;
    const edit = editedText(editBox.current?.value ?? "", item.text);
    /* The base goes too. A refusal here cannot be shown, because the tab is
       gone, and that is accepted: whoever saved first keeps their words. */
    return edit && edit !== base.current
      ? {
          method: "PATCH",
          url: `/api/checklist/${item.id}`,
          body: { text: edit, baseText: base.current },
        }
      : null;
  });

  async function saveText(id: string, text: string, from: string) {
    try {
      await api.patch(`/api/checklist/${id}`, { text, baseText: from });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setChanged({ id, mine: text });
      else onError(err instanceof Error ? err.message : "The checklist did not save.");
    }
    await reload();
  }

  async function run(work: () => Promise<unknown>) {
    try {
      await work();
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "The checklist did not save.");
      await reload();
    }
  }

  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <span className="label">Checklist</span>
        <span style={{ flex: 1 }} />
        {local.length > 0 && (
          <span
            className="mono"
            style={{ fontSize: 10.5, fontWeight: 500, color: "var(--accent-soft)" }}
          >
            {done} / {local.length}
          </span>
        )}
      </div>

      {local.length > 0 && (
        <div className={styles.progress}>
          {local.map((item, i) => (
            <span
              key={item.id}
              className={styles.progressCell}
              style={{ background: i < done ? "var(--accent)" : "#1c2126" }}
            />
          ))}
        </div>
      )}

      {loading && local.length === 0 && (
        <span style={{ fontSize: 12, color: "var(--faint)" }}>Loading…</span>
      )}

      {local.map((item) => (
        <Fragment key={item.id}>
          <div className={styles.check}>
            <button
              className={`${styles.box} ${item.done ? styles.boxOn : ""}`}
              aria-label={item.done ? "Mark as open" : "Mark as done"}
              onClick={() => {
                change((list) => list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
                void run(() => api.patch(`/api/checklist/${item.id}`, { done: !item.done }));
              }}
            />
            {changed?.id === item.id ? (
              <ChangedWhileTyping
                theirs={item.text}
                mine={changed.mine}
                by={null}
                onKeep={() => {
                  setChanged(null);
                  void saveText(item.id, changed.mine, item.text);
                }}
                onTake={() => setChanged(null)}
              />
            ) : editingId === item.id ? (
              <input
                ref={editBox}
                className={styles.checkInput}
                autoFocus
                defaultValue={item.text}
                onChange={() => setTyped(true)}
                onBlur={(e) => {
                  const text = e.target.value.trim();
                  const from = base.current;
                  editItem(null);
                  if (!text) void run(() => api.del(`/api/checklist/${item.id}`));
                  else if (text !== item.text && text !== from) void saveText(item.id, text, from);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") editItem(null);
                }}
              />
            ) : (
              <span
                className={`${styles.checkText} ${item.done ? styles.checkDone : ""}`}
                onClick={() => editItem(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && editItem(item)}
              >
                {item.text}
              </span>
            )}
            <button
              className={styles.checkRemove}
              aria-label={`Remove ${item.text}`}
              title="Remove"
              onClick={() => {
                change((list) => list.filter((i) => i.id !== item.id));
                void run(() => api.del(`/api/checklist/${item.id}`));
              }}
            >
              ✕
            </button>
          </div>
          <EditingSign said={signOf(item.id)} item />
        </Fragment>
      ))}

      {adding ? (
        <div className={styles.check}>
          <span className={styles.boxDash} />
          <input
            className={styles.checkInput}
            autoFocus
            value={draft}
            placeholder="What has to be true?"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const text = draft.trim();
              setDraft("");
              setAdding(false);
              if (text) void run(() => api.post(`/api/tasks/${taskId}/checklist`, { text }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const text = draft.trim();
                if (text) {
                  setDraft("");
                  void run(() => api.post(`/api/tasks/${taskId}/checklist`, { text }));
                }
                e.preventDefault();
              }
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
          />
        </div>
      ) : (
        <button className={styles.addItem} onClick={() => setAdding(true)}>
          <span className={styles.boxDash} />
          Add item
        </button>
      )}
    </div>
  );
}

function Comments({
  taskId,
  detail,
  me,
  description,
  onUseAsDescription,
  reload,
  onError,
}: {
  taskId: string;
  detail: TaskDetailDTO;
  me: { id: string; name: string; color: string };
  description: string;
  onUseAsDescription: (body: string) => Promise<unknown>;
  reload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { data } = useBoard();
  /* A note can be long, and a create is not a save, so the words wait in the
     browser until you send them rather than being sent when the tab goes. */
  const [draft, setDraft] = useDraft(commentDraftKey(data.project.id, taskId));
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  /* A name picked from the list is typing, so it goes into the draft and
     survives a closed tab like the rest of the note. */
  const picker = useMentions(box, setDraft);
  const agentAtWork = detail.run !== null;
  const waitingFor = detail.run?.status === "waiting" ? detail.run.agent.name : null;

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/tasks/${taskId}/comments`, { body: text });
      setDraft("");
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "The comment did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.feed}>
      {detail.comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          mine={comment.author?.id === me.id}
          description={description}
          onUseAsDescription={onUseAsDescription}
          reload={reload}
          onError={onError}
        />
      ))}

      <div className={styles.composer}>
        <Avatar name={me.name} color={me.color} size={24} />
        <div className={styles.composerBox}>
          <textarea
            ref={box}
            className={styles.composerInput}
            data-testid="comment-box"
            value={draft}
            placeholder={
              waitingFor
                ? `Answer ${waitingFor}…`
                : agentAtWork
                  ? "Leave a note for the agent…"
                  : "Leave a note…"
            }
            rows={3}
            onChange={(e) => {
              setDraft(e.target.value);
              picker.sync();
            }}
            onSelect={picker.sync}
            onBlur={picker.close}
            onKeyDown={(e) => {
              /* The list has the keys while it is open, so Enter picks a
                 name. Cmd + Enter still sends, which is how a note ends. */
              if (picker.onKeyDown(e)) return;
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <MentionList picker={picker} />
          <div className={styles.composerFoot}>
            <span style={{ fontSize: 10.5, color: "var(--faint-3)" }}>
              Markdown · Cmd + Enter to send
            </span>
            <span style={{ flex: 1 }} />
            <button
              className={`${styles.send} ${draft.trim() ? styles.sendOn : styles.sendOff}`}
              onClick={() => void send()}
              disabled={!draft.trim() || busy}
            >
              Comment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One comment. An agent that refines a task a person already described posts
 * its draft here rather than writing over their words, so the comment is
 * where a draft becomes the description, in one press. Replacing words that
 * are there asks first, and says how many are lost; filling an empty
 * description asks nothing, because nothing is lost.
 */
function CommentItem({
  comment,
  mine,
  description,
  onUseAsDescription,
  reload,
  onError,
}: {
  comment: TaskDetailDTO["comments"][number];
  mine: boolean;
  description: string;
  onUseAsDescription: (body: string) => Promise<unknown>;
  reload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const confirm = useConfirm();
  const already = comment.body.trim() === description.trim();
  const words = description.trim() ? description.trim().split(/\s+/).length : 0;

  const use = () => void onUseAsDescription(comment.body);

  return (
    <div className={styles.comment} data-testid="comment">
      <Avatar
        name={comment.author?.name ?? "?"}
        color={comment.author?.color ?? "#3f4650"}
        size={20}
      />
      <div className={styles.commentBody}>
        <div className={styles.commentHead}>
          <span className={styles.commentName}>{comment.author?.name ?? "Removed user"}</span>
          <span className={styles.commentTime}>{relativeTime(comment.createdAt)}</span>
          <span style={{ flex: 1 }} />
          {!already && !confirm.asking && (
            <button
              className={styles.commentUse}
              title="Make this comment the description"
              onClick={words ? confirm.ask : use}
            >
              Use as description
            </button>
          )}
          {mine && (
            <button
              className={styles.commentDelete}
              aria-label="Delete comment"
              title="Delete"
              onClick={async () => {
                try {
                  await api.del(`/api/comments/${comment.id}`);
                  await reload();
                } catch (err) {
                  onError(err instanceof Error ? err.message : "Could not delete.");
                }
              }}
            >
              ✕
            </button>
          )}
        </div>
        {confirm.asking && (
          <ConfirmRow
            question={`Replace the description with this comment? Its ${words} ${
              words === 1 ? "word goes" : "words go"
            }.`}
            confirmLabel="Yes, replace"
            onConfirm={() => confirm.confirm(use)}
            onCancel={confirm.cancel}
          />
        )}
        <div className={styles.commentText}>
          <Markdown text={comment.body} testId="comment-markdown" />
        </div>
      </div>
    </div>
  );
}
