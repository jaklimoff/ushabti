import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { SessionUser } from "@/components/ui/UserMenu";
import type {
  ActivityDTO,
  BoardData,
  ChecklistItemDTO,
  CommentDTO,
  MemberDTO,
  TaskDTO,
} from "@/lib/types";
import { detailOf, ME, type Answer } from "./board";

/*
 * The server, as far as the task panel reads and writes it: the board, the
 * tasks, their comments, checklists and feed. A text save that carries a base
 * is refused with 409 when the words moved, as the routes refuse it, so a
 * test can put somebody else's save in first with `wrote()`.
 *
 * It holds a copy of the board, because the store was handed `data`, and a
 * change made to that in place would be one nobody wrote.
 */

type Author = Pick<MemberDTO, "id" | "name" | "color" | "emoji" | "kind">;

let made = 0;
const id = () => {
  made += 1;
  return `00000000-0000-4000-9000-${String(made).padStart(12, "0")}`;
};

const TASK = /^\/api\/tasks\/([0-9a-f-]+)$/;
const COMMENTS = /^\/api\/tasks\/([0-9a-f-]+)\/comments$/;
const COMMENT = /^\/api\/comments\/([0-9a-f-]+)$/;
const CHECKLIST = /^\/api\/tasks\/([0-9a-f-]+)\/checklist$/;
const ITEM = /^\/api\/checklist\/([0-9a-f-]+)$/;
const NEW_TASK = /^\/api\/projects\/[0-9a-f-]+\/tasks$/;
const VALUE = /^\/api\/tasks\/([0-9a-f-]+)\/values\/([0-9a-f-]+)$/;

const refused = (current: string, field?: string) => ({
  status: 409,
  body: { error: "This changed while you typed.", field, current },
});

/**
 * `archived` holds the whole rows of the tasks in `data.archived`: the board
 * carries only their names, and a read of one answers all of it.
 */
export function serving(data: BoardData, user: SessionUser = ME, archived: TaskDTO[] = []) {
  const server = structuredClone(data);
  const comments = new Map<string, (CommentDTO & { taskId: string })[]>();
  const checklists = new Map<string, ChecklistItemDTO[]>();
  const activity = new Map<string, ActivityDTO[]>();
  const me: Author = { ...user, kind: "human" };

  const shelf = structuredClone(archived);
  const taskOf = (taskId: string) =>
    server.tasks.find((t) => t.id === taskId) ?? shelf.find((t) => t.id === taskId);
  const listOf = <T>(map: Map<string, T[]>, taskId: string) => {
    if (!map.has(taskId)) map.set(taskId, []);
    return map.get(taskId)!;
  };
  const authorOf = (who: Author) => ({
    id: who.id,
    name: who.name,
    color: who.color,
    emoji: who.emoji,
    kind: who.kind,
  });
  const log = (taskId: string, kind: string, by: Author) =>
    listOf(activity, taskId).unshift({
      id: id(),
      kind,
      data: {},
      createdAt: new Date().toISOString(),
      actor: authorOf(by),
    });
  const itemTask = (itemId: string) =>
    [...checklists.entries()].find(([, items]) => items.some((i) => i.id === itemId))?.[0];
  const commentOf = (commentId: string) =>
    [...comments.values()].flat().find((c) => c.id === commentId);

  /** Somebody else saved these fields of a task first. */
  const wrote = (task: TaskDTO, fields: { title?: string; description?: string }, by: Author) => {
    const now = taskOf(task.id)!;
    Object.assign(now, fields);
    for (const kind of Object.keys(fields)) log(task.id, kind, by);
  };

  /** A comment on a task, written by `by`. */
  const comment = (task: TaskDTO, body: string, by: Author = me) => {
    const made = {
      id: id(),
      taskId: task.id,
      body,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      editedAt: null,
      byProject: false,
      author: authorOf(by),
    };
    listOf(comments, task.id).push(made);
    return made;
  };

  /** An item of a task's checklist. */
  const item = (task: TaskDTO, text: string) => {
    const items = listOf(checklists, task.id);
    const made = { id: id(), text, done: false, position: `a${items.length}` };
    items.push(made);
    return made;
  };

  const answer: Answer = ({ method, path, body }) => {
    const sent = (body ?? {}) as Record<string, unknown>;
    if (method === "GET" && path.endsWith("/board")) return { body: server };

    let m = TASK.exec(path);
    if (m) {
      const task = taskOf(m[1]);
      if (!task) return { status: 404, body: { error: "Task not found." } };
      if (method === "GET")
        return {
          body: {
            task: detailOf(task, {
              comments: listOf(comments, task.id).map(({ taskId: _, ...c }) => c),
              checklist: [...listOf(checklists, task.id)],
              activity: [...listOf(activity, task.id)],
            }),
          },
        };
      if (method === "PATCH") {
        for (const field of ["title", "description"] as const) {
          const base = sent[field === "title" ? "baseTitle" : "baseDescription"];
          const words = sent[field];
          if (words === undefined) continue;
          if (typeof base === "string" && task[field] !== base && task[field] !== words)
            return refused(task[field], field);
        }
        for (const field of ["title", "description"] as const) {
          if (typeof sent[field] !== "string") continue;
          task[field] = sent[field] as string;
          log(task.id, field, me);
        }
        return { body: { task } };
      }
    }

    m = COMMENTS.exec(path);
    if (m && method === "POST") {
      const task = taskOf(m[1])!;
      const made = comment(task, String(sent.body));
      task.commentCount += 1;
      return { status: 201, body: { comment: made } };
    }

    m = COMMENT.exec(path);
    if (m) {
      const now = commentOf(m[1]);
      if (!now) return { status: 404, body: { error: "Comment not found." } };
      if (method === "PATCH") {
        const base = sent.baseBody;
        if (typeof base === "string" && now.body !== base && now.body !== sent.body)
          return refused(now.body, "body");
        if (now.body !== sent.body) {
          now.body = String(sent.body);
          now.editedAt = new Date().toISOString();
        }
        return { body: { comment: now } };
      }
      if (method === "DELETE") {
        const list = listOf(comments, now.taskId);
        list.splice(list.indexOf(now), 1);
        return { body: { ok: true } };
      }
    }

    m = CHECKLIST.exec(path);
    if (m && method === "POST")
      return { status: 201, body: { item: item(taskOf(m[1])!, String(sent.text)) } };

    m = ITEM.exec(path);
    if (m) {
      const taskId = itemTask(m[1]);
      const items = taskId ? listOf(checklists, taskId) : [];
      const now = items.find((i) => i.id === m![1]);
      if (!now) return { status: 404, body: { error: "Item not found." } };
      if (method === "PATCH") {
        const base = sent.baseText;
        if (typeof base === "string" && now.text !== base && now.text !== sent.text)
          return refused(now.text);
        if (typeof sent.text === "string") now.text = sent.text;
        if (typeof sent.done === "boolean") now.done = sent.done;
        return { body: { item: now } };
      }
      if (method === "DELETE") {
        items.splice(items.indexOf(now), 1);
        return { body: { ok: true } };
      }
    }

    if (method === "POST" && NEW_TASK.test(path)) {
      const number = Math.max(0, ...[...server.tasks, ...server.archived].map((t) => t.number)) + 1;
      const task: TaskDTO = {
        id: id(),
        number,
        key: `${server.project.key}-${number}`,
        title: String(sent.title),
        description: "",
        position: `b${String(number).padStart(7, "0")}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        values: (sent.values ?? {}) as TaskDTO["values"],
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        blockedBy: [],
        parts: null,
      };
      server.tasks.push(task);
      return { status: 201, body: { task } };
    }

    m = VALUE.exec(path);
    if (m && method === "PUT") {
      const task = taskOf(m[1])!;
      task.values = { ...task.values, [m[2]]: sent.value as never };
      return { body: { ok: true } };
    }
  };

  /** Edits what a checklist item says, as another tab saved it. */
  const itemWrote = (itemId: string, text: string) => {
    const taskId = itemTask(itemId)!;
    listOf(checklists, taskId).find((i) => i.id === itemId)!.text = text;
  };

  /** Edits a comment, as another tab of its author saved it. */
  const commentWrote = (commentId: string, body: string) => {
    const now = commentOf(commentId)!;
    now.body = body;
    now.editedAt = new Date().toISOString();
  };

  return {
    answer,
    server,
    taskOf,
    wrote,
    comment,
    commentOf,
    item,
    itemWrote,
    commentWrote,
  };
}

/** The words the live editor holds, as they will be saved. */
export function boxValue(): string {
  const el = page.getByTestId("live-editor").element() as unknown as {
    cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } };
  };
  const view = el.cmTile?.root?.view;
  if (!view) throw new Error("The description box is not a CodeMirror editor.");
  return view.state.doc.toString();
}

/**
 * The e2e helper `fillBox`: everything in the box, replaced by these words.
 * The words go in as one insertion, as Playwright's `insertText` puts them,
 * so a line break is a line and not an Enter the box would answer.
 */
export async function fillBox(text: string) {
  (page.getByTestId("live-editor").element() as HTMLElement).focus();
  await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}");
  if (text === "") await userEvent.keyboard("{Backspace}");
  else document.execCommand("insertText", false, text);
  await expect.poll(boxValue).toBe(text);
  /* The box hands its words to the panel on its next render. A person never
     leaves a box in the same frame they typed in it, and a test must not
     either, or the blur reads a panel that has not seen the typing yet. */
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
