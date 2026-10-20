"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/components/board/store";
import { api } from "@/lib/client";
import { ruleAsked } from "@/lib/when";
import type { PropertyDTO, When } from "@/lib/types";

/**
 * The one way a page writes when a property shows.
 *
 * The Properties page ticks options and the types grid ticks a type, and
 * both are this: a rule that hides
 * values on tasks asks first, with the count, and the write drops them. The
 * count is the server's, because archived tasks lose theirs too. An answer
 * that lands after another write is dropped.
 *
 * It holds one question at a time, whichever property asked it, so a grid of
 * many properties asks in one place.
 */
export function useWhenWrites() {
  const { patchProperty, notify } = useBoard();
  const [asking, setAsking] = useState<{
    propertyId: string;
    when: When | null;
    question: string;
  } | null>(null);
  const asked = useRef(0);

  /* A write that shows more and hides nothing goes without a count. */
  function save(property: PropertyDTO, when: When | null) {
    asked.current++;
    setAsking(null);
    void patchProperty(property.id, { when });
  }

  /* Even no rule at all can hide: it may let a rule elsewhere out of a
     circle. So everything else is counted first. */
  async function write(property: PropertyDTO, when: When | null) {
    const mine = ++asked.current;
    setAsking(null);
    try {
      const drops = await api.get<{ tasks: number; names: string[] }>(
        `/api/properties/${property.id}/count?when=${encodeURIComponent(JSON.stringify(when))}`,
      );
      if (asked.current !== mine) return;
      if (drops.tasks === 0) return void patchProperty(property.id, { when });
      setAsking({ propertyId: property.id, when, question: `${ruleAsked(drops)}.` });
    } catch {
      if (asked.current === mine) notify("Could not count the values the rule hides.");
    }
  }

  function confirm() {
    if (!asking) return;
    const { propertyId, when } = asking;
    asked.current++;
    setAsking(null);
    void patchProperty(propertyId, { when });
  }

  function cancel() {
    asked.current++;
    setAsking(null);
  }

  return { asking, save, write, confirm, cancel };
}

/** The writes of one property's rule. */
export function useWhenWrite(property: PropertyDTO) {
  const writes = useWhenWrites();
  const rule = property.config.when ?? null;

  /* Tick or untick one option of a select. */
  function toggle(select: PropertyDTO, id: string, on: boolean) {
    const ticked = rule && rule.propertyId === select.id ? rule.optionIds : [];
    const next = on ? [...ticked, id] : ticked.filter((t) => t !== id);
    const when = next.length ? { propertyId: select.id, optionIds: next } : null;
    /* One more option under the same rule shows more and hides nothing. */
    if (on && rule?.propertyId === select.id) return writes.save(property, when);
    return write(when);
  }

  function write(when: When | null) {
    return writes.write(property, when);
  }

  return {
    rule,
    asking: writes.asking,
    toggle,
    write,
    confirm: writes.confirm,
    cancel: writes.cancel,
  };
}
