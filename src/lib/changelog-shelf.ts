/**
 * The public changelog, kept between visits.
 *
 * A stranger's visit used to read and build the whole changelog every time.
 * Now a page is built once and kept until the project changes. `broadcast()`
 * is the one door every write goes out by, so it forgets the project there,
 * and nothing has to know which write a stranger can see. A page is also
 * dropped after `KEEP_MS`, for a change that went past that door, such as a
 * migration.
 *
 * It is in memory, as the rate limit is: one server is the only deployment,
 * so a second process would keep pages of its own and be forgotten by its own
 * writes only. Next's own data cache was the other way, but `revalidateTag`
 * throws outside a request Next is serving, and the route tests call the
 * routes, and so `broadcast()`, directly.
 *
 * It keeps the promise and not the answer, so ten strangers who arrive
 * together build the page once, and a write forgets a build still on its way:
 * the read it made may be older than the write.
 */

/** How long a page is kept when nothing forgets it sooner. */
export const KEEP_MS = 10 * 60 * 1000;

/** How many pages are kept, across every project. The oldest goes first. */
export const KEEP_PAGES = 200;

export type Shelf<T> = {
  /** The page kept under this project and size, or a fresh one from `build`. */
  get(projectId: string, shown: number, build: () => Promise<T>, now?: number): Promise<T>;
  /** Forgets every page of one project. */
  forget(projectId: string): void;
  /** How many pages are kept. The test reads it; nothing else does. */
  size(): number;
};

export function createShelf<T>(): Shelf<T> {
  const kept = new Map<string, { at: number; page: Promise<T> }>();
  const keyOf = (projectId: string, shown: number) => `${projectId} ${shown}`;

  return {
    get(projectId, shown, build, now = Date.now()) {
      const key = keyOf(projectId, shown);
      const hit = kept.get(key);
      if (hit && hit.at > now - KEEP_MS) return hit.page;

      kept.delete(key);
      const page = build();
      kept.set(key, { at: now, page });
      // A build that failed is not kept, so the next visit tries again.
      page.catch(() => {
        if (kept.get(key)?.page === page) kept.delete(key);
      });
      // A Map walks in the order keys went in, so the first is the oldest.
      for (const old of kept.keys()) {
        if (kept.size <= KEEP_PAGES) break;
        kept.delete(old);
      }
      return page;
    },
    forget(projectId) {
      const prefix = `${projectId} `;
      for (const key of kept.keys()) if (key.startsWith(prefix)) kept.delete(key);
    },
    size() {
      return kept.size;
    },
  };
}

/**
 * The one shelf of this process. It sits on `globalThis` because Next builds
 * each route on its own, and a module's own variable would give the page one
 * shelf and every write route another.
 */
const globalForShelf = globalThis as unknown as { __ushabtiChangelogs?: Shelf<unknown> };

export function changelogShelf<T>(): Shelf<T> {
  return (globalForShelf.__ushabtiChangelogs ??= createShelf<unknown>()) as Shelf<T>;
}

/** Forgets a project's public changelog. `broadcast()` calls it on every write. */
export function forgetChangelog(projectId: string): void {
  globalForShelf.__ushabtiChangelogs?.forget(projectId);
}
