import { pointerWithin, rectIntersection, type CollisionDetection } from "@dnd-kit/core";
import { CHIP_PLACES } from "@/lib/card-view";

/** Every place a chip can be dropped: the edge, the five boxes and the tray. */
export const DROP_ZONES = ["edge", ...CHIP_PLACES, "off"] as const;
export type DropZone = (typeof DROP_ZONES)[number];

type Arrow = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/* The card as it is drawn: the edge down the left, two boxes on top, the body
   under the title, two boxes at the foot, and the tray under the card. */
const WAYS: Record<DropZone, Partial<Record<Arrow, DropZone>>> = {
  edge: { ArrowRight: "headerL", ArrowDown: "off" },
  headerL: { ArrowLeft: "edge", ArrowRight: "headerR", ArrowDown: "body" },
  headerR: { ArrowLeft: "headerL", ArrowDown: "body" },
  body: { ArrowUp: "headerL", ArrowLeft: "edge", ArrowDown: "footerL" },
  footerL: { ArrowUp: "body", ArrowLeft: "edge", ArrowRight: "footerR", ArrowDown: "off" },
  footerR: { ArrowUp: "body", ArrowLeft: "footerL", ArrowDown: "off" },
  off: { ArrowUp: "footerL" },
};

/**
 * Where an arrow key takes a lifted chip. A zone that cannot take the chip is
 * stepped over in the same direction; with nothing past it the chip stays.
 */
export function zoneToward(
  from: DropZone,
  key: string,
  closed: (zone: DropZone) => boolean,
): DropZone | null {
  let at = from;
  for (let i = 0; i < DROP_ZONES.length; i++) {
    const next = WAYS[at][key as Arrow];
    if (!next) return null;
    if (!closed(next)) return next;
    at = next;
  }
  return null;
}

/**
 * The zone under the pointer first, then the one the chip's middle sits in,
 * then the one it overlaps most. Never the distance between corners: the edge
 * is as tall as the card, so its corners are far from everything.
 */
export const zoneCollision: CollisionDetection = (args) => {
  const under = pointerWithin(args);
  if (under.length) return under;

  const rect = args.collisionRect;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  for (const container of args.droppableContainers) {
    const r = args.droppableRects.get(container.id);
    if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
      return [{ id: container.id, data: { droppableContainer: container, value: 0 } }];
  }
  return rectIntersection(args);
};
