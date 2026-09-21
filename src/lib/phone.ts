/**
 * How wide the window is, for the one screen that has to change with it.
 *
 * The server cannot know the width, exactly as it cannot know a fold, so this
 * is an outside store the board reads rather than state copied in after the
 * first paint. The number is 560 because two 272 px columns need 576: below it
 * a second column cannot honestly be drawn, and #63, #66 and #68 already call
 * that width a phone.
 */

export const PHONE_WIDTH = 560;

const QUERY = `(max-width: ${PHONE_WIDTH}px)`;

let media: MediaQueryList | null = null;

function ask(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  media ??= window.matchMedia(QUERY);
  return media;
}

export function subscribePhone(listener: () => void): () => void {
  const mql = ask();
  if (!mql) return () => {};
  mql.addEventListener("change", listener);
  return () => mql.removeEventListener("change", listener);
}

export function isPhone(): boolean {
  return ask()?.matches ?? false;
}

/** What the server draws: the board it has always drawn. */
export function notPhone(): boolean {
  return false;
}

/**
 * Which way a finger went, as a step through the columns.
 *
 * A finger travelling left brings the next column in, the way a page turns.
 * It has to go 60 px to mean anything, and further sideways than up or down,
 * or a thumb scrolling a column would page the board by accident.
 */
export const SWIPE = 60;

export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
