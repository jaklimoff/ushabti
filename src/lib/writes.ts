/*
 * Which of this tab's writes are still out, and whether a read may land.
 *
 * A read answers with things as they were when the server got to it. If one of
 * this tab's writes was out at any moment while the read was, the answer may
 * be from before that write, and drawing it quietly undoes the click that
 * sent the write. Counting only the writes that start during a read is not
 * enough: a write sent a moment before the read can reach the database after
 * the read is answered. So the count moves when a write goes out and again
 * when it is answered, and a read that went out while a write was out never
 * lands.
 *
 * Of two reads, only the newer one lands. An older one that comes back last
 * is as stale as one that crossed a write, and the newer one is still coming,
 * so nothing is owed for it.
 *
 * A read dropped for a write is owed: it asked for something that has not
 * reached the screen. It is asked again once no write is out, so a dropped
 * read never leaves the screen behind for good.
 */

export type Reading = { readonly read: number; readonly wrote: number | null };

export type Writes = {
  /** A write goes out. Call what it gives back once it is answered, either way. */
  begin: () => () => void;
  /** A read goes out. Hand what it gives back to `keep` with the answer. */
  reading: () => Reading;
  /**
   * Whether the answer to that read may be drawn. When it may not because of
   * a write, the read is asked again as soon as no write is out.
   */
  keep: (reading: Reading) => boolean;
};

export function trackWrites(readAgain: () => void): Writes {
  let wrote = 0;
  let out = 0;
  let reads = 0;
  let owed = false;

  const settle = () => {
    if (out > 0 || !owed) return;
    owed = false;
    readAgain();
  };

  return {
    begin() {
      wrote += 1;
      out += 1;
      let answered = false;
      return () => {
        if (answered) return;
        answered = true;
        wrote += 1;
        out -= 1;
        settle();
      };
    },
    reading() {
      reads += 1;
      return { read: reads, wrote: out > 0 ? null : wrote };
    },
    keep(reading) {
      if (reading.read !== reads) return false;
      if (reading.wrote === wrote) return true;
      owed = true;
      settle();
      return false;
    },
  };
}
