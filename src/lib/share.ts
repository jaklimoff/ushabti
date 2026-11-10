/**
 * The fresh answer, with every part that reads the same as before put back
 * as the object it was.
 *
 * A read of the board hands back new objects for every task, so a card that
 * draws only when its task changes would draw for every read. Kept here, a
 * task nobody touched is the same object it was, and a read that changed
 * nothing hands back `before` itself, which React takes as no change at all.
 *
 * It knows plain JSON only — objects, arrays and scalars — which is all an
 * answer of the API can hold.
 */
export function shareEqual<T>(before: T, fresh: T): T {
  return share(before, fresh) as T;
}

function share(before: unknown, fresh: unknown): unknown {
  if (Object.is(before, fresh)) return before;
  if (Array.isArray(before) && Array.isArray(fresh)) {
    /* A list of things with ids is matched by id, so one task added at the
       top does not make every task under it read as new. */
    const byId = before.every(hasId) ? new Map(before.map((item) => [item.id, item])) : null;
    let same = before.length === fresh.length;
    const out = fresh.map((item, i) => {
      const old = byId && hasId(item) ? byId.get(item.id) : before[i];
      const kept = old === undefined ? item : share(old, item);
      if (kept !== before[i]) same = false;
      return kept;
    });
    return same ? before : out;
  }
  if (isPlain(before) && isPlain(fresh)) {
    const keys = Object.keys(fresh);
    let same = keys.length === Object.keys(before).length;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const kept = Object.hasOwn(before, key) ? share(before[key], fresh[key]) : fresh[key];
      if (kept !== before[key] || !Object.hasOwn(before, key)) same = false;
      out[key] = kept;
    }
    return same ? before : out;
  }
  return fresh;
}

function hasId(value: unknown): value is { id: string } {
  return isPlain(value) && typeof value.id === "string";
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
