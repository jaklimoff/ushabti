"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { copyText } from "@/lib/clipboard";
import { leadProperty, relativeTime } from "@/lib/board";
import { tint } from "@/lib/colors";
import {
  duration,
  elapsed,
  isOpen,
  leaseLeft,
  lifeOf,
  LIFE_WORD,
  progressOf,
  runLine,
  STATUS_WORD,
} from "@/lib/run-state";
import type {
  AgentRunDetailDTO,
  ChecklistItemDTO,
  RunControl,
  TaskDetailDTO,
  TaskValue,
} from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { useNow } from "@/components/ui/useElapsed";
import { useDismiss } from "@/components/ui/useDismiss";
import { PropertyControl } from "./controls/PropertyControl";
import { Markdown } from "./Markdown";
import { useBoard } from "./store";
import styles from "./panel.module.css";

export function TaskPanel({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const {
    data,
    user,
    groupProperty,
    setValue,
    patchTask,
    deleteTask,
    addOption,
    syncTaskCounts,
    controlRun,
    notify,
  } = useBoard();
  const [detail, setDetail] = useState<TaskDetailDTO | null>(null);
  const [tab, setTab] = useState<"comments" | "activity" | "agent">("comments");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useDismiss<HTMLDivElement>(() => setMenuOpen(false), menuOpen);

  const boardTask = data.tasks.find((t) => t.id === taskId) ?? null;

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ task: TaskDetailDTO | null }>(`/api/tasks/${taskId}`);
      setDetail(res.task);
      if (!res.task) {
        onClose();
        return;
      }
      syncTaskCounts(taskId, {
        checklistTotal: res.task.checklist.length,
        checklistDone: res.task.checklist.filter((c) => c.done).length,
        commentCount: res.task.comments.length,
      });
    } catch {
      onClose();
    }
  }, [onClose, syncTaskCounts, taskId]);

  // Only a different task clears what is on screen. A new `load` identity must
  // not, because that unmounts the comment list and destroys the note the
  // person is part-way through writing.
  useEffect(() => {
    setDetail(null);
  }, [taskId]);

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
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "Escape" && !typing) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* The task key is its address: the panel writes the open task into the
     query, so the address bar already holds the link a person wants to paste
     into a chat. This copies that same shape from wherever the board is
     served, so a link made behind a proxy still points at the proxy. */
  const copyLink = useCallback(async () => {
    const link = `${window.location.origin}/p/${data.project.id}?task=${taskId}`;
    if (await copyText(link)) notify("Link copied", "info");
    else notify("The link did not copy. The address bar holds it.");
  }, [data.project.id, notify, taskId]);

  /* the band and the pill follow the same property the card square uses */
  const leadPill = useMemo(() => {
    if (!boardTask) return null;
    const property = leadProperty(data.properties, groupProperty?.id ?? null);
    if (!property) return null;
    return property.options.find((o) => o.id === boardTask.values[property.id]) ?? null;
  }, [boardTask, data.properties, groupProperty]);

  const accent = leadPill?.color ?? "#3f4650";

  // The agent tab only exists while a run does. Deriving the shown tab rather
  // than resetting it in an effect keeps the choice in one place.
  const run = detail?.run ?? null;
  const shownTab = tab === "agent" && !run ? "comments" : tab;

  if (!boardTask) return null;

  return (
    <aside className={styles.panel} data-testid="task-panel">
      <div className={styles.accent} style={{ background: accent }} />

      <div className={styles.head} style={{ background: tint(accent, 0.06) }} ref={menuRef}>
        <div className={styles.headRow}>
          <button
            type="button"
            className={styles.key}
            data-testid="task-key"
            title="Copy link to this task"
            aria-label={`Copy link to ${boardTask.key}`}
            onClick={() => void copyLink()}
          >
            {boardTask.key}
          </button>
          {leadPill && (
            <span className={styles.leadPill} style={{ background: tint(leadPill.color, 0.16) }}>
              <span
                style={{ width: 5, height: 5, borderRadius: "50%", background: leadPill.color }}
              />
              {leadPill.name}
            </span>
          )}
          <span style={{ flex: 1 }} />
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
          value={boardTask.title}
          onCommit={(title) => void patchTask(taskId, { title })}
        />
      </div>

      <div className={styles.body}>
        <div className={styles.props}>
          {data.properties.map((property, index) => (
            <div key={property.id} style={{ display: "contents" }}>
              <div className={`${styles.propLabel} ${index > 0 ? styles.rowLine : ""}`}>
                {property.name}
              </div>
              <div className={`${styles.propValue} ${index > 0 ? styles.rowLine : ""}`}>
                <PropertyControl
                  property={property}
                  value={boardTask.values[property.id] ?? null}
                  members={data.members}
                  onChange={(value: TaskValue) => void setValue(taskId, property.id, value)}
                  onAddOption={
                    property.type === "select" || property.type === "multi_select"
                      ? (name) => addOption(property.id, name)
                      : undefined
                  }
                />
              </div>
            </div>
          ))}
        </div>

        <div className={styles.section}>
          <Description
            value={boardTask.description}
            onCommit={(description) => void patchTask(taskId, { description })}
          />

          <Checklist
            taskId={taskId}
            items={detail?.checklist ?? []}
            loading={!detail}
            reload={load}
            onError={notify}
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
          {run && (
            <button
              className={`${styles.tab} ${shownTab === "agent" ? styles.tabOn : ""}`}
              onClick={() => setTab("agent")}
              data-testid="agent-tab"
            >
              <span
                className={`${styles.tabDot} ${run.status === "running" ? styles.tabDotLive : ""}`}
                style={{ background: run.agent.color }}
              />
              Agent
            </button>
          )}
        </div>

        {!detail && <div className={styles.loading}>Loading…</div>}

        {detail && shownTab === "comments" && (
          <Comments taskId={taskId} detail={detail} me={user} reload={load} onError={notify} />
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

        {run && shownTab === "agent" && (
          <AgentRunBlock
            run={run}
            onControl={async (control) => {
              await controlRun(run.id, control);
              await load();
            }}
          />
        )}
      </div>
    </aside>
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
    case "run":
      return `${who} ${RUN_WORDS[d.action ?? ""] ?? "changed the run"}`;
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
  lost: "stopped answering, so the board closed the run",
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
          className={`${styles.runNowDot} ${paused ? styles.runNowDotPaused : ""}`}
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
          <div className={styles.runPlan}>
            {run.steps.map((step) => (
              <div key={step.id} className={styles.runStep}>
                <span
                  className={`${styles.runStepBox} ${
                    step.state === "done"
                      ? styles.runStepDone
                      : step.state === "active"
                        ? styles.runStepActive
                        : ""
                  }`}
                  style={step.state === "done" ? { background: run.agent.color } : undefined}
                />
                <span
                  className={`${styles.runStepText} ${
                    step.state === "done" ? styles.runStepStruck : ""
                  }`}
                >
                  {step.text}
                </span>
                {step.state === "active" && <span className={styles.runSince}>{since}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {run.log.length > 0 && (
        <div className={styles.runLog} data-testid="panel-run-log">
          {run.log.map((line) => (
            <div key={line.id} className={styles.runLogRow}>
              <span className={styles.runLogTime}>{relativeTime(line.createdAt)}</span>
              <span className={styles.runLogText}>{line.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.runNote}>
        Your edits still save while the agent works. Take over ends the run and gives you the card.
      </div>

      <div className={styles.runButtons}>
        {paused ? (
          <button className={styles.runButton} disabled={busy} onClick={() => void press("resume")}>
            Resume
          </button>
        ) : (
          <button className={styles.runButton} disabled={busy} onClick={() => void press("pause")}>
            Pause
          </button>
        )}
        <button className={styles.runButton} disabled={busy} onClick={() => void press("stop")}>
          Stop
        </button>
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

function TitleField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  return (
    <textarea
      ref={ref}
      className={styles.title}
      data-testid="task-title"
      value={draft}
      rows={1}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const trimmed = draft.trim();
        if (trimmed && trimmed !== value) onCommit(trimmed);
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function Description({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

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
      {editing ? (
        <textarea
          className={styles.descEditor}
          autoFocus
          value={draft}
          placeholder="Write in markdown…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== value) onCommit(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
        />
      ) : (
        <div
          className={styles.desc}
          onClick={() => setEditing(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
        >
          {value.trim() ? <Markdown text={value} /> : "Add a description…"}
        </div>
      )}
    </div>
  );
}

function Checklist({
  taskId,
  items,
  loading,
  reload,
  onError,
}: {
  taskId: string;
  items: ChecklistItemDTO[];
  loading: boolean;
  reload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [local, setLocal] = useState<ChecklistItemDTO[]>(items);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => setLocal(items), [items]);

  const done = local.filter((i) => i.done).length;

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
        <div key={item.id} className={styles.check}>
          <button
            className={`${styles.box} ${item.done ? styles.boxOn : ""}`}
            aria-label={item.done ? "Mark as open" : "Mark as done"}
            onClick={() => {
              setLocal((list) => list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
              void run(() => api.patch(`/api/checklist/${item.id}`, { done: !item.done }));
            }}
          />
          {editingId === item.id ? (
            <input
              className={styles.checkInput}
              autoFocus
              defaultValue={item.text}
              onBlur={(e) => {
                const text = e.target.value.trim();
                setEditingId(null);
                if (!text) void run(() => api.del(`/api/checklist/${item.id}`));
                else if (text !== item.text)
                  void run(() => api.patch(`/api/checklist/${item.id}`, { text }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingId(null);
              }}
            />
          ) : (
            <span
              className={`${styles.checkText} ${item.done ? styles.checkDone : ""}`}
              onClick={() => setEditingId(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setEditingId(item.id)}
            >
              {item.text}
            </span>
          )}
          <button
            className={styles.checkRemove}
            aria-label={`Remove ${item.text}`}
            title="Remove"
            onClick={() => {
              setLocal((list) => list.filter((i) => i.id !== item.id));
              void run(() => api.del(`/api/checklist/${item.id}`));
            }}
          >
            ✕
          </button>
        </div>
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
  reload,
  onError,
}: {
  taskId: string;
  detail: TaskDetailDTO;
  me: { id: string; name: string; color: string };
  reload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const agentAtWork = detail.run !== null;

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
        <div key={comment.id} className={styles.comment}>
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
              {comment.author?.id === me.id && (
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
            <div className={styles.commentText}>{comment.body}</div>
          </div>
        </div>
      ))}

      <div className={styles.composer}>
        <Avatar name={me.name} color={me.color} size={24} />
        <div className={styles.composerBox}>
          <textarea
            className={styles.composerInput}
            value={draft}
            placeholder={agentAtWork ? "Leave a note for the agent…" : "Leave a note…"}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className={styles.composerFoot}>
            <span style={{ fontSize: 10.5, color: "var(--faint-3)" }}>Cmd + Enter to send</span>
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
