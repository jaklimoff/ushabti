import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { ErrorBoundaryHandler } from "next/dist/client/components/error-boundary";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import RootError from "./error";
import GlobalError from "./global-error";
import SignedInError from "./(app)/error";

/*
 * Try again used to call `reset`, which draws the same failed answer again:
 * a board read that timed out stayed timed out. `retry` reads the page again.
 */

type Boundary = (props: {
  error: unknown;
  retry: () => void;
  reset: () => void;
}) => React.ReactNode;

const BOUNDARIES: [string, Boundary][] = [
  ["error.tsx", RootError as Boundary],
  ["global-error.tsx", GlobalError as Boundary],
  ["(app)/error.tsx", SignedInError as Boundary],
];

afterEach(() => vi.restoreAllMocks());

describe("Try again", () => {
  for (const [name, Boundary] of BOUNDARIES) {
    test(`in ${name} calls retry once and reset never`, async () => {
      const retry = vi.fn();
      const reset = vi.fn();
      /* global-error draws its own html; the test only needs its button. */
      vi.spyOn(console, "error").mockImplementation(() => {});
      await render(<Boundary error={new Error("boom")} retry={retry} reset={reset} />);
      await page.getByRole("button", { name: "Try again" }).click();
      expect(retry).toHaveBeenCalledTimes(1);
      expect(reset).not.toHaveBeenCalled();
    });

    test(`in ${name} names a digest only when it is a string`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const noop = () => {};
      const { container, rerender } = await render(
        <Boundary error={{ digest: "d-123" }} retry={noop} reset={noop} />,
      );
      expect(container.textContent).toContain("d-123");
      await rerender(<Boundary error={{ digest: 42 }} retry={noop} reset={noop} />);
      expect(container.textContent).not.toContain("42");
      await rerender(<Boundary error={null} retry={noop} reset={noop} />);
      expect(container.textContent).toContain("Try again");
    });
  }
});

function Thrower({ value }: { value: unknown }): React.ReactNode {
  throw value;
}

const router = {
  refresh: vi.fn(),
  back: () => {},
  forward: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
} as unknown as AppRouterInstance;

describe("A value that is not an Error", () => {
  for (const value of ["a plain string", null, 7]) {
    test(`thrown as ${JSON.stringify(value)} draws the boundary with no second error`, async () => {
      const errors: unknown[] = [];
      vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
      const second = vi.fn();
      window.addEventListener("error", second);
      try {
        const { container } = await render(
          <AppRouterContext.Provider value={router}>
            <ErrorBoundaryHandler pathname="/p/x" errorComponent={SignedInError}>
              <Thrower value={value} />
            </ErrorBoundaryHandler>
          </AppRouterContext.Provider>,
        );
        await expect.element(page.getByText("Something broke")).toBeVisible();
        expect(container.textContent).toContain("The page could not finish loading.");
        /* React reports the value it caught once; a boundary that threw in
           turn would report a second, and would not have drawn. */
        const reported = errors.filter((e) => JSON.stringify(e).includes("digest"));
        expect(reported).toEqual([]);
        expect(second).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener("error", second);
      }
    });
  }
});
