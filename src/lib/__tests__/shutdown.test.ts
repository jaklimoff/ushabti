import { afterEach, describe, expect, it, vi } from "vitest";
import { endStreams, holdStream, isStopping, onStop } from "../shutdown";

describe("shutdown", () => {
  afterEach(() => vi.useRealTimers());

  it("ends every open stream on SIGTERM, refuses new ones, and leaves by the deadline", () => {
    vi.useFakeTimers();
    const ended: string[] = [];
    holdStream(() => ended.push("a"));
    const letGo = holdStream(() => ended.push("b"));
    holdStream(() => {
      throw new Error("already gone");
    });
    holdStream(() => ended.push("c"));
    letGo();

    const signals = new Map<string, () => void>();
    const exit = vi.fn();
    onStop((signal, listener) => signals.set(signal, listener), exit, 3_000);
    expect(isStopping()).toBe(false);

    signals.get("SIGTERM")!();
    expect(ended).toEqual(["a", "c"]);
    expect(isStopping()).toBe(true);
    expect(exit).not.toHaveBeenCalled();

    /* A second signal does not start a second stop. */
    signals.get("SIGINT")!();
    vi.advanceTimersByTime(3_000);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(143);
    expect(endStreams()).toBe(0);
  });
});
