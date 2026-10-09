/* The app router is mounted by Next, and a component test mounts none. A
   component that pushes a route in a test goes nowhere, which is all a test
   of what it draws needs. Where it would have gone is written down, for a
   test that asks. */
export const pushed: string[] = [];

const router = {
  push: (href: string) => void pushed.push(href),
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
};

export function useRouter() {
  return router;
}

/* Where a test says the page is, for a component that lights what it is on.
   Null reads the address of the page the test is drawn in. */
export const at: { pathname: string | null } = { pathname: null };

export function usePathname() {
  return at.pathname ?? window.location.pathname;
}

/* Next throws to stop the render, and so does this, after writing where. */
export function redirect(href: string): never {
  pushed.push(href);
  throw new Error(`NEXT_REDIRECT ${href}`);
}

export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}
