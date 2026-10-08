/* The app router is mounted by Next, and a component test mounts none. A
   component that pushes a route in a test goes nowhere, which is all a test
   of what it draws needs. */
const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
};

export function useRouter() {
  return router;
}

export function usePathname() {
  return window.location.pathname;
}

export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}
