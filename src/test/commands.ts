import type { BrowserCommand } from "vitest/node";

/*
 * Commands run beside the browser, in Node, where Playwright's own mouse is.
 * dnd-kit and the panel's grip listen to pointer events and need real
 * movement, which `userEvent.dragAndDrop` does not give them: it presses,
 * jumps once and lets go. So the walk is the e2e helper `dragOnto`'s, in the
 * page's own coordinates.
 */

type Point = { x: number; y: number };

/** Presses at `from`, walks to `to` in small steps and lets go there. */
const drag: BrowserCommand<[from: Point, to: Point]> = async (context, from, to) => {
  if (context.provider.name !== "playwright") throw new Error("drag needs Playwright.");
  const { page, frame } = context as unknown as {
    page: import("playwright").Page;
    frame: () => Promise<import("playwright").Frame>;
  };
  /* A box measured inside the test is measured in the iframe the test is
     drawn in, and the mouse moves in the page around it. */
  const at = await (await (await frame()).frameElement()).boundingBox();
  const x = (p: Point) => p.x + (at?.x ?? 0);
  const y = (p: Point) => p.y + (at?.y ?? 0);

  await page.mouse.move(x(from), y(from));
  await page.mouse.down();
  await page.mouse.move(x(from) + 6, y(from) + 6, { steps: 4 });
  const steps = 20;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      x(from) + ((to.x - from.x) * i) / steps,
      y(from) + ((to.y - from.y) * i) / steps,
    );
    if (i % 5 === 0) await page.waitForTimeout(24);
  }
  await page.waitForTimeout(140);
  await page.mouse.up();
};

/** Turns the page's reduced motion on or off, as the person's system would. */
const reduceMotion: BrowserCommand<[on: boolean]> = async (context, on) => {
  if (context.provider.name !== "playwright") throw new Error("reduceMotion needs Playwright.");
  const { page } = context as unknown as { page: import("playwright").Page };
  await page.emulateMedia({ reducedMotion: on ? "reduce" : "no-preference" });
};

export const commands = { drag, reduceMotion };

declare module "vitest/browser" {
  interface BrowserCommands {
    drag: (from: Point, to: Point) => Promise<void>;
    reduceMotion: (on: boolean) => Promise<void>;
  }
}
