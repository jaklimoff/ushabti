"use client";

import { useCallback, useSyncExternalStore } from "react";
import { draftOf, noDraft, subscribeDraft, writeDraft } from "@/lib/draft";

/**
 * A composer's words, kept in the browser until they are sent.
 *
 * It answers like `useState`, so a composer changes one line, but the value
 * lives outside React. The server draws an empty box, because it cannot know
 * what one browser typed, and the words arrive the moment that browser takes
 * over — the same way a folded column does. Reading storage into state in an
 * effect would say the same thing one paint later, and
 * `react-hooks/set-state-in-effect` refuses it.
 *
 * Write an empty string to throw the draft away. Sending is what usually does
 * it.
 */
export function useDraft(key: string): [string, (text: string) => void] {
  const draft = useSyncExternalStore(subscribeDraft, () => draftOf(key), noDraft);
  const write = useCallback((text: string) => writeDraft(key, text), [key]);
  return [draft, write];
}
