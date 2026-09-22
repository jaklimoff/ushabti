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
 * It listens on `pagehide` alone, which is the closed tab and the navigation
 * away — the two moments the page is really going. `visibilitychange` to
 * hidden is not one of them: an alt-tab on a desktop raises it while the page
 * lives on with the cursor still in the box, so a half-typed project key would
 * be written and broadcast to the whole team. That is the autosave this task
 * rules out. The price is mobile Safari, which raises no `pagehide` when a tab
 * is switched away; an edit left that way is still lost, as it is today.
 *
 * A field must answer for what somebody typed in this tab and nothing else.
 * A box that mirrors a saved value holds the old words after another tab
 * changes it, and sending those would put the change back. So each field
 * carries a flag it sets on the first change since its last save, and answers
 * null until it is set.
 *
 * A test can only see this from the other side. Chromium hands a `keepalive`
 * request to the browser process as the page goes, and reports it to nobody:
 * neither `page.on("request")`, nor the same listener on the context, nor
 * `context.route()` sees it, although the server takes it. So the end to end
 * proof of a leave is what the next page draws, and a count of the request
 * would read as zero whatever this hook did.
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
      /* Marked before the send, not after: a page kept for the back button is
         hidden, shown and hidden again, and the second must not repeat a
         request still in flight. */
      sent.current = next.mark;
      const { method, url, body } = next.send;
      /* A field patches its row and a filter puts a whole lens, so the address
         carries the method it would have been saved by. */
      const request = method === "PUT" ? api.put : api.patch;
      void request(url, body, { keepalive: true }).catch(() => {
        /* The page is going. There is nobody left to tell. */
      });
    }

    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);
}
