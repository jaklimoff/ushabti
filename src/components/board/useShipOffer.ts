"use client";

import { readCadence, sprintAfter } from "@/lib/cadence";
import { canManage } from "@/lib/roles";
import { closes, nextOpenOption, shipSaid } from "@/lib/ship";
import { isSelect } from "@/lib/types";
import type { ShipOffer } from "./Column";
import { useBoard } from "./store";

/**
 * How an option may ship, asked by the column header and by the roadmap row,
 * so the two doors offer it to the same people and send the same request.
 *
 * An option may ship only where its column may be swept, and only for the
 * people the route lets through: a ship is a sweep and more, and a button the
 * route would refuse is a button that lies. Under a filter the cards on screen
 * are not the whole option, so the numbers in the question would not be the
 * numbers that go.
 */
export function useShipOffer() {
  const { data, groupProperty, filters, shipOption, notify } = useBoard();
  const canShip = !!groupProperty && filters.rules.length === 0 && canManage(data.project.role);

  /** `onShipped` runs once the server said yes, for what only this door does. */
  return (option: { id: string; name: string }, onShipped?: () => void): ShipOffer | null => {
    if (!canShip || !groupProperty || !isSelect(groupProperty.type)) return null;
    /* An iteration's ship makes the next sprint when there is none, so the
       question names the one it will make. */
    const nextName =
      nextOpenOption(groupProperty, groupProperty.options, option.id)?.name ??
      (groupProperty.type === "iteration"
        ? (sprintAfter(
            groupProperty.options,
            option.id,
            readCadence(groupProperty.config),
            data.today,
          )?.name ?? null)
        : null);
    const closing = closes(groupProperty);
    return {
      nextName,
      closing,
      onShip: async (rest) => {
        const done = await shipOption(option.id, rest);
        if (!done) return false;
        onShipped?.();
        notify(shipSaid(option.name, done, nextName, closing), "info");
        return true;
      },
    };
  };
}
