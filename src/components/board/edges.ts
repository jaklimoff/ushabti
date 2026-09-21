import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./board.module.css";

/**
 * A row of pills that pans sideways, and the fade that says there is more.
 *
 * The view strip and the column strip are the same row twice: pills wider than
 * the space they have, scrolling with the scrollbar hidden. A hidden scrollbar
 * leaves nothing to say that anything is past the edge, so each end that has
 * more is faded — which is the only signal there is. Measured in one place
 * because two copies drift, and a strip that lies about its edges is worse
 * than one that never faded.
 *
 * `count` is how many pills there are: the row is measured again when it
 * changes, because a pill added or taken away moves both edges.
 */
export function useEdgeFade(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft > 2,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, count]);

  const fade = [edges.start ? styles.fadeStart : "", edges.end ? styles.fadeEnd : ""]
    .filter(Boolean)
    .join(" ");

  return { ref, fade, measure };
}
