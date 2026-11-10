import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, REQUEST_TIMEOUT_MS } from "../client";

/*
 * A write that never comes back held the board still for good, because every
 * read is dropped while a write is out. It fails after about 30 seconds.
 */
describe("a request that is never answered", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails after about 30 seconds, as any failed write does", async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    const clock = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(clock.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) =>
            init.signal!.addEventListener("abort", () =>
              reject(new DOMException("timed out", "TimeoutError")),
            ),
          ),
      ),
    );
    const write = api.patch("/api/tasks/t1", { title: "x" });
    expect(timeout).toHaveBeenCalledWith(30_000);
    clock.abort();
    const err = await write.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("The server did not answer in time.");
  });
});
