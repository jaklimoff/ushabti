"use client";

import { useCallback } from "react";
import type { FilterRule } from "@/lib/types";
import { useBoard } from "./store";

/**
 * Makes an option of the property a view is drawn by: a column on a board, a
 * release on a roadmap. Both are the same write, so both join the filter the
 * same way.
 */
export function useAddOption() {
  const { groupProperty, viewFilters, lens, addOption, setFilters, setLens } = useBoard();

  return useCallback(
    async (name: string, dates?: { targetAt: string }) => {
      if (!groupProperty) return null;
      const optionId = await addOption(groupProperty.id, name, dates);

      /*
       * A rule about the grouping property decides the columns, so a column
       * made under one would fail it and vanish the moment it was named.
       * Nobody makes a column in order not to see it: the new option joins the
       * rule instead.
       *
       * Whichever set the rule is in is the set that is written. A rule of the
       * view is the team's, so the column joins it for everybody; a rule of
       * mine is mine, and the view is not touched.
       */
      if (!optionId) return null;
      const join = (rules: FilterRule[]) =>
        rules.map((rule) =>
          rule.propertyId === groupProperty.id && rule.op === "is"
            ? { ...rule, values: [...(rule.values ?? []), optionId] }
            : rule,
        );

      const onView = join(viewFilters.rules);
      if (onView.some((rule, i) => rule !== viewFilters.rules[i])) await setFilters(onView);
      const mine = join(lens.rules);
      if (mine.some((rule, i) => rule !== lens.rules[i])) await setLens(mine);
      return optionId;
    },
    [groupProperty, viewFilters, lens, addOption, setFilters, setLens],
  );
}
