/**
 * What the keys of a `Select` do, and where its menu sits. Pure, so a test
 * can hold the rules without a browser.
 */

export type SelectOption = { value: string; label: string; disabled?: boolean };

/** The highest a menu grows before it scrolls, as the board's menu does. */
export const MENU_MAX = 260;
const GAP = 4;
const EDGE = 8;

/**
 * The next enabled option from `at`. It stops at an end rather than wrap,
 * as a native select does, so holding a key never circles back unseen.
 */
export function step(options: SelectOption[], at: number, move: 1 | -1 | "first" | "last"): number {
  if (move === "first") return step(options, -1, 1);
  if (move === "last") return step(options, options.length, -1);
  for (let i = at + move; i >= 0 && i < options.length; i += move) {
    if (!options[i].disabled) return i;
  }
  return Math.min(Math.max(at, 0), options.length - 1);
}

/** How long after a key the next one still adds to the same word. */
export const TYPE_PAUSE = 700;

/**
 * The word typed so far once this key is in, or null when the key is not
 * typing. A space adds to a word already begun, so "No select" can be typed
 * in full; a space that begins nothing is left to open or pick.
 */
export function typedWord(
  typed: { word: string; at: number },
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  now: number,
): string | null {
  const { key } = event;
  if (key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return null;
  const going = typed.word !== "" && now - typed.at < TYPE_PAUSE;
  if (key === " " && !going) return null;
  return going ? typed.word + key : key;
}

/**
 * The option a typed word jumps to, or -1. One letter looks past the current
 * option, so pressing it again walks every option it starts; a longer word
 * keeps the current one while it still matches.
 */
export function typeAhead(options: SelectOption[], at: number, typed: string): number {
  const word = typed.toLowerCase();
  const from = word.length === 1 ? at + 1 : Math.max(at, 0);
  for (let n = 0; n < options.length; n++) {
    const i = (from + n) % options.length;
    const option = options[i];
    if (!option.disabled && option.label.toLowerCase().startsWith(word)) return i;
  }
  return -1;
}

type Box = { top: number; bottom: number; left: number; width: number };
export type MenuPlace = { top?: number; bottom?: number; left: number; maxHeight: number };

/**
 * Where the menu sits, in window pixels. It is drawn fixed so that a card's
 * edge cannot cut it, and it opens upward when the window has no room under
 * the button for it.
 */
export function placeMenu(
  button: Box,
  menu: { height: number; width: number },
  window: { height: number; width: number },
): MenuPlace {
  const want = Math.min(menu.height, MENU_MAX);
  const below = window.height - button.bottom - GAP - EDGE;
  const above = button.top - GAP - EDGE;
  const width = Math.max(menu.width, button.width);
  const left = Math.max(EDGE, Math.min(button.left, window.width - EDGE - width));
  if (below >= want || below >= above) {
    return { top: button.bottom + GAP, left, maxHeight: Math.min(MENU_MAX, below) };
  }
  return {
    bottom: window.height - button.top + GAP,
    left,
    maxHeight: Math.min(MENU_MAX, above),
  };
}
