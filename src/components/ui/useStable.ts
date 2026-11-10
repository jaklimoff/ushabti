import { useCallback, useInsertionEffect, useMemo, useRef } from "react";

/**
 * One function for the life of the component, which calls the newest `fn`.
 *
 * A card that draws only when its props change needs handlers that do not
 * change, while the handler still has to act on the board as it is now. The
 * newest `fn` is put in place before any effect runs, as the store's actions
 * are, so a press never acts on the board as it was a render ago.
 */
export function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  useInsertionEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

/**
 * The ids of `items`, as the same array for as long as they are the same ids
 * in the same order. dnd-kit takes a new array of items as a change of order
 * and puts every card's transition to nothing for a frame, which hands every
 * card a new style and draws it again.
 */
export function useSameIds(items: readonly { id: string }[]): string[] {
  const last = useRef<string[]>([]);
  return useMemo(() => {
    const ids = items.map((item) => item.id);
    const was = last.current;
    if (was.length === ids.length && was.every((id, i) => id === ids[i])) return was;
    last.current = ids;
    return ids;
  }, [items]);
}
