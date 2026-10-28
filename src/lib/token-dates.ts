/**
 * How a token row says when: when it was made, when it was last used, and
 * when it ends. Account and Settings → People draw the same row, and they
 * used to write two wordings and two date orders on it.
 *
 * Whole days only, so a list of tokens never has to tick. A token is read
 * after the page has loaded, in the browser, so a `Date` read in the
 * reader's zone is the day the reader means.
 */

import { formatDate } from "./board";

const DAY_MS = 86_400_000;

/** An end this close is worth a colour: whatever uses the token stops soon. */
export const SOON_DAYS = 14;

/** A day as the board writes it, "Oct 28", with the year when it is not this one. */
function writtenDay(iso: string, now: number): string {
  const date = new Date(iso);
  const day = formatDate(
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
  );
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

/** Whole days back — "today", "yesterday", "3 days ago" — then a written day past a month. */
export function tokenAgo(iso: string, now: number = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 31) return `${days} days ago`;
  return writtenDay(iso, now);
}

/** How far off the end is. Near, it counts the days; far, it names the day. */
export function tokenExpiry(
  iso: string | null,
  now: number = Date.now(),
): { text: string; soon: boolean } {
  if (!iso) return { text: "never expires", soon: false };
  const days = Math.ceil((new Date(iso).getTime() - now) / DAY_MS);
  if (days > SOON_DAYS) return { text: `expires ${writtenDay(iso, now)}`, soon: false };
  if (days <= 0) return { text: "expires today", soon: true };
  if (days === 1) return { text: "expires tomorrow", soon: true };
  return { text: `expires in ${days} days`, soon: true };
}
