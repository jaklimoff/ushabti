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

/**
 * Whom the person picker offers for what somebody typed: the reader first,
 * because the person most often picked is the one picking, then everyone
 * else in the order they came, which is by name. Typing narrows by the rule
 * a select's menu uses — the exact name first, then any name holding the
 * words — so the two boxes never answer one word two ways.
 */
export function personMenu(
  members: readonly MemberDTO[],
  me: string | null,
  draft: string,
): MemberDTO[] {
  const mine = members.filter((m) => m.id === me);
  const ordered = [...mine, ...members.filter((m) => m.id !== me)];
  const typed = draft.trim().toLowerCase();
  if (!typed) return ordered;
  const same = (m: MemberDTO) => m.name.trim().toLowerCase() === typed;
  const exact = ordered.filter(same);
  const partial = ordered.filter((m) => !same(m) && m.name.toLowerCase().includes(typed));
  return [...exact, ...partial];
}

/**
 * Where the highlight sits when the picker opens, in a menu whose first row
 * is the empty one: on the person the field names, or on the reader when it
 * names nobody who can still be picked.
 */
export function personOpeningAt(
  rows: readonly MemberDTO[],
  value: string | null,
  me: string | null,
): number {
  const chosen = rows.findIndex((m) => m.id === value);
  if (chosen >= 0) return chosen + 1;
  return rows.findIndex((m) => m.id === me) + 1;
}
