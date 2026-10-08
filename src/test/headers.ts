import { AsyncLocalStorage } from "node:async_hooks";

/**
 * `next/headers` for a route test. Next reads the request a handler is
 * answering from its own store; here `src/test/route.ts` puts the request in
 * this one, so two calls that run at once each read their own caller.
 */
export const requests = new AsyncLocalStorage<Request>();

function current(): Request {
  const req = requests.getStore();
  if (!req) throw new Error("next/headers was read outside a call from src/test/route.ts.");
  return req;
}

export async function headers(): Promise<Headers> {
  return current().headers;
}

export async function cookies() {
  const jar = new Map<string, string>();
  for (const part of (current().headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) jar.set(part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1).trim()));
  }
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    has: (name: string) => jar.has(name),
    // A route test reads what a handler answers, never a cookie it sets.
    set: () => undefined,
    delete: () => undefined,
  };
}
