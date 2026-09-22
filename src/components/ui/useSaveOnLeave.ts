"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/client";
import { sendOnLeave, type LeaveSend } from "@/lib/leave";

/**
 * The blur the browser never sends.
 *
 * Every field on this board saves on blur, and a tab closed with the field
 * still focused raises no blur, so the edit is gone. The field says here what
 * it would send if it were blurred now; when the page goes, that request goes
 * with `keepalive`, which the browser finishes after the page is gone.
 *
 * The field answers with a function rather than a value because it is asked at
 * the moment of leaving. A box that holds its words in the DOM rather than in
 * state can then read itself, and the answer is never one render old.
 *
 * It listens on `pagehide` and on `visibilitychange` to hidden. `pagehide` is
 * the close and the navigation. Hidden is the one mobile Safari sends: it
 * raises no `pagehide` when a tab is switched away or the home screen is
 * reached, and it may then freeze or throw the page away with no further
 * event. `sendOnLeave` keeps one edit from going out twice when both fire.
 *
 * A `keepalive` body has to stay under 64 KiB. A long description could pass
 * that, and the browser then refuses the send, exactly as it refuses today's
 * lost blur — nothing is made worse, and the `catch` keeps the refusal quiet
 * on a page nobody is looking at any more.
 */
export function useSaveOnLeave(unsaved: () => LeaveSend | null): void {
  const latest = useRef(unsaved);
  latest.current = unsaved;

  const sent = useRef<string | null>(null);

  useEffect(() => {
    function leave() {
      const next = sendOnLeave(latest.current(), sent.current);
      if (!next) return;
      /* Marked before the send, not after: the two events can fire in one
         breath, and the second must not repeat a request still in flight. */
      sent.current = next.mark;
      const { method, url, body } = next.send;
      const request = method === "PUT" ? api.put : api.patch;
      void request(url, body, { keepalive: true }).catch(() => {
        /* The page is going. There is nobody left to tell. */
      });
    }

    function onHidden() {
      if (document.visibilityState === "hidden") leave();
    }

    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);
}
