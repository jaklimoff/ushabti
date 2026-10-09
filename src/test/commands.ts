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

/* A page with touch on answers `(hover: none)`, as a phone does, which is how
   Playwright's `hasTouch` reaches the CSS. One session per page, kept, so the
   setting holds until the test turns it off. */
const sessions = new WeakMap<object, import("playwright").CDPSession>();
const touch: BrowserCommand<[on: boolean]> = async (context, on) => {
  if (context.provider.name !== "playwright") throw new Error("touch needs Playwright.");
  const { page } = context as unknown as { page: import("playwright").Page };
  let session = sessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    sessions.set(page, session);
  }
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: on, maxTouchPoints: 1 });
};

export const commands = { drag, touch };

declare module "vitest/browser" {
  interface BrowserCommands {
    drag: (from: Point, to: Point) => Promise<void>;
    touch: (on: boolean) => Promise<void>;
  }
}
