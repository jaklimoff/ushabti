import type { PropertyDTO, TaskDTO, ViewDTO } from "./types";

/**
 * What Use releases or Use sprints keeps when it goes off, said in real
 * numbers. Off clears the project's pointer and nothing else, so the question
 * names what stays: a person who reads only "turn off?" fears for the data.
 */
export function offQuestion(
  noun: "release" | "sprint",
  property: Pick<PropertyDTO, "id" | "name" | "options">,
  tasks: readonly Pick<TaskDTO, "values">[],
  views: readonly Pick<ViewDTO, "groupById" | "filters">[],
): string {
  const options = property.options.length;
  const holders = tasks.filter((t) => hasValue(t.values[property.id])).length;
  const using = views.filter(
    (v) => v.groupById === property.id || v.filters.rules.some((r) => r.propertyId === property.id),
  ).length;
  const plural = `${noun}s`;
  const kept = [
    `${property.name} keeps its ${options} ${options === 1 ? noun : plural}`,
    holders === 0
      ? `no task holds a ${noun}`
      : `${holders} ${holders === 1 ? "task keeps its" : "tasks keep their"} ${noun}`,
    `${using} ${using === 1 ? "view stays" : "views stay"}`,
  ];
  return `Turn ${plural} off? Nothing is deleted: ${kept[0]}, ${kept[1]}, and ${kept[2]}.`;
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && value !== "";
}
