import type { FormerDTO, MemberDTO } from "./types";

/**
 * Whoever a person value names, member or not.
 *
 * Somebody who left keeps their tasks, so a value can name a user who is no
 * longer in `members`. `former` holds those, and this is the one lookup that
 * reads both: members first, so a person who came back reads as a member
 * again with nothing written.
 */
export type Person = FormerDTO & { gone: boolean };

export function personOf(
  id: unknown,
  members: readonly MemberDTO[],
  former: readonly FormerDTO[] = [],
): Person | null {
  if (typeof id !== "string" || !id) return null;
  const member = members.find((m) => m.id === id);
  if (member) {
    return {
      id: member.id,
      name: member.name,
      color: member.color,
      emoji: member.emoji,
      kind: member.kind,
      gone: false,
    };
  }
  const left = former.find((f) => f.id === id);
  return left ? { ...left, gone: true } : null;
}

/** The name a value reads as: "Ada", or "Ada (left)" for somebody who left. */
export function personName(person: Person): string {
  return person.gone ? `${person.name} (left)` : person.name;
}
