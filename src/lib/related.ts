import type { ArchivedTaskDTO, TaskDTO, TaskValue } from "./types";

/** A task a Tasks value names, as a field draws it. */
export type Related = { id: string; key: string; title: string; archived: boolean };

/**
 * The one lookup for a Tasks value, as `personOf()` is for a person: a live
 * task first, then an archived one, and null for an id that names neither.
 *
 * Nothing rewrites a value when a task is deleted, so a value can name a task
 * that is gone. The board carries no deleted task, so it reads as null and is
 * not drawn; restored, it is on the board again and reads back with nothing
 * written.
 */
export function taskOf(
  id: unknown,
  live: readonly Pick<TaskDTO, "id" | "key" | "title">[],
  archived: readonly Pick<ArchivedTaskDTO, "id" | "key" | "title">[] = [],
): Related | null {
  if (typeof id !== "string" || !id) return null;
  const task = live.find((t) => t.id === id);
  if (task) return { id: task.id, key: task.key, title: task.title, archived: false };
  const over = archived.find((t) => t.id === id);
  return over ? { id: over.id, key: over.key, title: over.title, archived: true } : null;
}

/** Every task a value names that is still there, in the order it was picked. */
export function tasksOf(
  value: TaskValue,
  live: readonly Pick<TaskDTO, "id" | "key" | "title">[],
  archived: readonly Pick<ArchivedTaskDTO, "id" | "key" | "title">[] = [],
): Related[] {
  if (!Array.isArray(value)) return [];
  return value.map((id) => taskOf(id, live, archived)).filter((t): t is Related => t !== null);
}
