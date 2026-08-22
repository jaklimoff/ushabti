"use client";

import { useEffect, useRef } from "react";

/** Closes a popover on an outside click or on Escape. */
export function useDismiss<T extends HTMLElement>(close: () => void, active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, close]);

  return ref;
}
