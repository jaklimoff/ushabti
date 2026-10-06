"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/components/board/store";
import { api } from "@/lib/client";
import { ruleAsked } from "@/lib/when";
import type { PropertyDTO, When } from "@/lib/types";

/**
 * The one way a page writes when a property shows.
 *
 * The Properties page ticks options and the Types page adds a property to a
 * type, and both are this: a rule that hides values on tasks asks first, with
 * the count, and the write drops them. The count is the server's, because
 * archived tasks lose theirs too. An answer that lands after another write is
 * dropped.
 */
export function useWhenWrite(property: PropertyDTO) {
  const { patchProperty, notify } = useBoard();
  const rule = property.config.when ?? null;
  const [asking, setAsking] = useState<{ when: When | null; question: string } | null>(null);
  const asked = useRef(0);

  /* Tick or untick one option of a select. */
  function toggle(select: PropertyDTO, id: string, on: boolean) {
    const ticked = rule && rule.propertyId === select.id ? rule.optionIds : [];
    const next = on ? [...ticked, id] : ticked.filter((t) => t !== id);
    const when = next.length ? { propertyId: select.id, optionIds: next } : null;
    /* One more option under the same rule shows more and hides nothing. */
    if (on && rule?.propertyId === select.id) {
      asked.current++;
      setAsking(null);
      return void patchProperty(property.id, { when });
    }
    return write(when);
  }

  /* Even no rule at all can hide: it may let a rule elsewhere out of a
     circle. So everything else is counted first. */
  async function write(when: When | null) {
    const mine = ++asked.current;
    setAsking(null);
    try {
      const drops = await api.get<{ tasks: number; names: string[] }>(
        `/api/properties/${property.id}/count?when=${encodeURIComponent(JSON.stringify(when))}`,
      );
      if (asked.current !== mine) return;
      if (drops.tasks === 0) return void patchProperty(property.id, { when });
      setAsking({ when, question: `${ruleAsked(drops)}.` });
    } catch {
      if (asked.current === mine) notify("Could not count the values the rule hides.");
    }
  }

  function confirm() {
    if (!asking) return;
    const { when } = asking;
    asked.current++;
    setAsking(null);
    void patchProperty(property.id, { when });
  }

  function cancel() {
    asked.current++;
    setAsking(null);
  }

  return { rule, asking, toggle, write, confirm, cancel };
}
