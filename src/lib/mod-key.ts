/**
 * The word for the key that sends a note: ⌘ on a Mac, Ctrl everywhere else.
 * The handlers take either key, so this only decides what the hint says.
 *
 * The server cannot know which machine reads the page, so it says nothing
 * (`null`) and the browser fills the word in once it has taken over. A guess
 * on the server would be wrong for half the readers and make React warn.
 */
export type ModKey = "⌘" | "Ctrl";

/** `platform` is `navigator.platform`: "MacIntel", "Win32", "iPhone", "Linux x86_64". */
export function modKeyFor(platform: string): ModKey {
  return /^(Mac|iPhone|iPad|iPod)/.test(platform) ? "⌘" : "Ctrl";
}

/** The two answers for `useSyncExternalStore`, which never change. */
export const modKeyInBrowser = (): ModKey => modKeyFor(navigator.platform);
export const modKeyOnServer = (): ModKey | null => null;
