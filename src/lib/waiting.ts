import { waitingTasks } from "./filters";
import { runLine } from "./run-state";
import { hitNote, type Searchable } from "./search";
import type { AgentRunDTO } from "./types";

/**
 * The tasks where an agent asked a person something, for the top bar.
 *
 * It is a live list and not an inbox: nothing is read or unread, and a row
 * goes the moment its run stops waiting. Like a search, it looks at every task
 * of the project and never at the view, so a filter, a lens, a folded column
 * or a list cannot hide a question. Which tasks wait is `waitingTasks()`, the
 * same answer the "Agent waiting" filter reads, so the two cannot disagree.
 */

export type WaitingRow = {
  task: Searchable;
  run: AgentRunDTO;
  /** The first line of the question, as the card strip reads it. */
  question: string;
  /** "not in this view", by the rule search uses, or null. */
  note: string | null;
};

/**
 * The rows, the oldest ask first.
 *
 * Only live tasks are handed in. An archived task is on no board, and a
 * question on it is not one anybody is asked to answer from here.
 */
export function waitingRows(
  tasks: Searchable[],
  runs: AgentRunDTO[],
  shown: Set<string>,
): WaitingRow[] {
  const waits = waitingTasks(runs);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const rows: WaitingRow[] = [];
  for (const run of runs) {
    if (!waits.has(run.taskId)) continue;
    const task = byId.get(run.taskId);
    if (!task || task.archivedAt) continue;
    rows.push({
      task,
      run,
      question: runLine(run).split("\n")[0].trim(),
      note: hitNote(task, shown.has(task.id)),
    });
  }
  /* The run's last report is when it asked: a waiting run says nothing more
     until somebody answers. That is the clock the card strip reads too. */
  return rows.sort((a, b) => {
    const one = new Date(a.run.updatedAt).getTime();
    const other = new Date(b.run.updatedAt).getTime();
    return one - other || (a.task.position < b.task.position ? -1 : 1);
  });
}

/** The browser tab's title, with the count in front while there is one. */
export function titleWithCount(title: string, count: number): string {
  const bare = title.replace(/^\(\d+\) /, "");
  return count > 0 ? `(${count}) ${bare}` : bare;
}
