/**
 * The `@` a person types in a box, and who it can name.
 *
 * An agent wakes on its own name in a comment, so the name has to be typed
 * exactly. Nobody can see the names, and a name with a space is easy to get
 * wrong. So the box offers them, and what it writes is what the watcher looks
 * for: `@Name ` and nothing else.
 *
 * Every box asks these three questions and nothing else — where the word is,
 * who it can be, what to write — so a title, a description and a comment can
 * never disagree about what an `@` means.
 */

import { isListening } from "./presence";
import type { MemberDTO } from "./types";

/** The `@word` the caret is in: where the `@` sits, and the letters after it. */
export type MentionQuery = { start: number; query: string };

/**
 * The word the caret is in, or null when the caret is not in one.
 *
 * The `@` opens a name only at the start of a word, so an email address in a
 * comment offers nothing. The letters hold no space, which ends the word at
 * the space the insertion leaves behind: picking a name closes the list.
 */
export function mentionAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(before[start - 1])) return null;
  const query = before.slice(start + 1);
  if (/\s/.test(query)) return null;
  return { start, query };
}

/**
 * How many names the list offers at once. A list that fills the board is not
 * a completion any more; the letters after the `@` are how you reach the
 * rest.
 */
export const MENTION_LIMIT = 8;

/** A name the list offers, and whether that agent would hear a task now. */
export type Mention = { member: MemberDTO; listening: boolean };

/**
 * Who the letters can name.
 *
 * The agents come first, because the mention is what wakes one; a person is
 * named to be read later. Inside each group the members keep their own order,
 * so the list is the same list every time it opens.
 *
 * The letters match the start of the name or the start of any word in it, so
 * `@wor` finds "Code Worker". Nothing matches by the middle of a word: a
 * completion that jumps about cannot be predicted.
 */
export function mentionsFor(
  members: MemberDTO[],
  query: string,
  now: number = Date.now(),
): Mention[] {
  const wanted = query.toLowerCase();
  const hit = (name: string) =>
    !wanted ||
    name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(wanted));
  const found = members.filter((m) => hit(m.name));
  const rank = (m: MemberDTO) => (m.kind === "agent" ? 0 : 1);
  return found
    .map((member, i) => ({ member, i }))
    .sort((a, b) => rank(a.member) - rank(b.member) || a.i - b.i)
    .slice(0, MENTION_LIMIT)
    .map(({ member }) => ({
      member,
      listening: member.kind === "agent" && isListening(member.listeningAt, now),
    }));
}

/**
 * The box after a name is picked: `@Name ` in place of what was typed, and
 * the caret after the space.
 *
 * The name goes in whole, spaces and all, because that is what the watcher
 * reads. The word always ends in a space, which closes the list and starts
 * the sentence again. A space already there serves as that one, and the caret
 * steps over it, so a name written into the middle of a line leaves one space
 * and not two.
 */
export function insertMention(
  text: string,
  caret: number,
  name: string,
): { text: string; caret: number } | null {
  const found = mentionAt(text, caret);
  if (!found) return null;
  const rest = text.slice(caret);
  const spaced = rest.startsWith(" ");
  const words = `@${name}${spaced ? "" : " "}`;
  return {
    text: text.slice(0, found.start) + words + rest,
    caret: found.start + words.length + (spaced ? 1 : 0),
  };
}
