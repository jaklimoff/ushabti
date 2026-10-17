import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which personal token this request came with, so that every line it writes
 * says so without a caller passing it on. `route()` opens the scope and
 * `getActor()` fills it. Work done outside a request, as the run lease does,
 * has no scope and writes no "via".
 */
type Scope = { via?: { userId: string; tokenId: string } };

const scope = new AsyncLocalStorage<Scope>();

export function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run({}, fn);
}

export function actingVia(userId: string, tokenId: string): void {
  const now = scope.getStore();
  if (now) now.via = { userId, tokenId };
}

/**
 * The token a line by `actorId` was written with. Only the token's own person
 * carries it: a line this request writes for somebody else, or for the
 * project, was not written with it.
 */
export function viaFor(actorId: string | null | undefined): string | null {
  const via = scope.getStore()?.via;
  return via && actorId && via.userId === actorId ? via.tokenId : null;
}
