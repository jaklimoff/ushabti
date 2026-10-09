import type { BoardData, TaskDTO, TaskLinkDTO } from "@/lib/types";
import { detailOf, ME, type Answer } from "./board";
import { serving } from "./panel";

/*
 * `serving()`, with what a task waits on and what it is part of: the two
 * link routes, the board read that works out the chain and the count of
 * parts, a read of one task with its four lists, and the archive and the
 * delete of one task, which make a link over or take it away.
 *
 * The rules — a circle, one level deep — answer here with the sentences the
 * routes answer with, so the panel has something to draw. Whether the server
 * keeps them is `links-route.test.ts`.
 */

const TASK = /^\/api\/tasks\/([0-9a-f-]+)$/;
const BLOCKERS = /^\/api\/tasks\/([0-9a-f-]+)\/blockers$/;
const BLOCKER = /^\/api\/tasks\/([0-9a-f-]+)\/blockers\/([0-9a-f-]+)$/;
const PARENT = /^\/api\/tasks\/([0-9a-f-]+)\/parent$/;
const ARCHIVE = /^\/api\/tasks\/([0-9a-f-]+)\/archive$/;

const refused = (error: string) => ({ status: 409, body: { error } });

export function linking(data: BoardData) {
  const fake = serving(data, ME);
  const { server } = fake;
  /** Every task there was, by id, so an archived one still reads whole. */
  const rows = new Map<string, TaskDTO>(server.tasks.map((t) => [t.id, t]));
  /** What each task waits on. */
  const waits = new Map<string, Set<string>>();
  /** The one task each part is part of. */
  const parentOf = new Map<string, string>();

  const archived = (id: string) => server.archived.some((t) => t.id === id);
  const there = (id: string) => archived(id) || server.tasks.some((t) => t.id === id);
  const over = (id: string) => {
    const done = server.project.doneWhen;
    const task = rows.get(id)!;
    const value = done ? task.values[done.propertyId] : null;
    return archived(id) || (typeof value === "string" && !!done?.optionIds.includes(value));
  };
  const link = (id: string): TaskLinkDTO => {
    const t = rows.get(id)!;
    return { id, key: t.key, title: t.title, over: over(id) };
  };
  const waitsOn = (id: string) => [...(waits.get(id) ?? [])].filter(there);
  const blocks = (id: string) =>
    [...waits.keys()].filter((w) => there(w) && waitsOn(w).includes(id));
  const parent = (id: string) => {
    const p = parentOf.get(id);
    return p && there(p) ? p : null;
  };
  const children = (id: string) =>
    [...parentOf.entries()]
      .filter(([child, p]) => p === id && there(child))
      .map(([child]) => rows.get(child)!)
      .sort((a, b) => (a.position < b.position ? -1 : 1))
      .map((t) => t.id);

  /** The board as the server reads it: the chain and the count, worked out. */
  const settle = () => {
    for (const task of server.tasks) {
      task.blockedBy = waitsOn(task.id)
        .filter((b) => !over(b))
        .map((b) => rows.get(b)!.key);
      const parts = children(task.id);
      task.parts = parts.length ? { done: parts.filter(over).length, total: parts.length } : null;
    }
  };

  /** Does `from` wait on `to`, through any number of links? */
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return waitsOn(from).some((next) => reaches(next, to, seen));
  };

  const answer: Answer = (sent) => {
    const { method, path } = sent;
    const body = (sent.body ?? {}) as Record<string, string>;
    if (method === "GET" && path.endsWith("/board")) {
      settle();
      return { body: server };
    }

    let m = TASK.exec(path);
    if (m && method === "GET") {
      const task = rows.get(m[1]);
      if (!task || !there(task.id)) return { status: 404, body: { error: "Task not found." } };
      settle();
      const up = parent(task.id);
      return {
        body: {
          task: detailOf(task, {
            links: { blockedBy: waitsOn(task.id).map(link), blocks: blocks(task.id).map(link) },
            parent: up ? link(up) : null,
            children: children(task.id).map(link),
          }),
        },
      };
    }
    if (m && method === "DELETE") {
      const id = m[1];
      server.tasks = server.tasks.filter((t) => t.id !== id);
      server.archived = server.archived.filter((t) => t.id !== id);
      return { body: { ok: true, goesAt: null } };
    }

    m = BLOCKERS.exec(path);
    if (m && method === "POST") {
      const [waiting, blocker] = [rows.get(m[1])!, rows.get(body.blockerId)!];
      if (reaches(blocker.id, waiting.id))
        return refused(
          `${blocker.key} already waits on ${waiting.key}, so this would be a circle.`,
        );
      if (!waits.has(waiting.id)) waits.set(waiting.id, new Set());
      waits.get(waiting.id)!.add(blocker.id);
      return { status: 201, body: { ok: true } };
    }
    m = BLOCKER.exec(path);
    if (m && method === "DELETE") {
      waits.get(m[1])?.delete(m[2]);
      return { body: { ok: true } };
    }

    m = PARENT.exec(path);
    if (m && method === "PUT") {
      const [child, to] = [rows.get(m[1])!, rows.get(body.parentId)!];
      if (child.id === to.id) return refused("A task cannot be part of itself.");
      const above = parent(to.id);
      if (above)
        return refused(
          `${to.key} is part of ${rows.get(above)!.key}, so it cannot have parts of its own.`,
        );
      if (children(child.id).length)
        return refused(`${child.key} has parts of its own, so it cannot be part of another task.`);
      const left = parent(child.id);
      parentOf.set(child.id, to.id);
      return { body: { ok: true, left: left && left !== to.id ? rows.get(left)!.key : null } };
    }
    if (m && method === "DELETE") {
      parentOf.delete(m[1]);
      return { body: { ok: true } };
    }

    m = ARCHIVE.exec(path);
    if (m && method === "POST") {
      const task = rows.get(m[1])!;
      const archivedAt = new Date().toISOString();
      task.archivedAt = archivedAt;
      server.tasks = server.tasks.filter((t) => t.id !== task.id);
      const { id, number, key, title, description, position } = task;
      server.archived.push({ id, number, key, title, description, position, archivedAt });
      return { body: { ok: true } };
    }

    return fake.answer(sent);
  };

  /** Says, before the board is drawn, that `waiting` waits on `blocker`. */
  const blockedBy = (waiting: TaskDTO, blocker: TaskDTO) => {
    if (!waits.has(waiting.id)) waits.set(waiting.id, new Set());
    waits.get(waiting.id)!.add(blocker.id);
    settle();
    data.tasks = structuredClone(server.tasks);
  };

  /** Says, before the board is drawn, that `child` is part of `to`. */
  const partOf = (child: TaskDTO, to: TaskDTO) => {
    parentOf.set(child.id, to.id);
    settle();
    data.tasks = structuredClone(server.tasks);
  };

  return { ...fake, answer, blockedBy, partOf, settle };
}
