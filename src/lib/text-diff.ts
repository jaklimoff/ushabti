/**
 * What one edit of a description did, line by line, over the Markdown as it
 * was written. Pure, and with no dependency: a description holds at most
 * 20,000 characters, so a plain Myers walk over its lines is quick enough.
 *
 * Inside a hunk the lines taken away come before the lines added, and a
 * taken-away line is paired with the added line in the same place, so a line
 * that changed in part can mark the words that changed in it.
 */

/** A piece of a line, marked when it is what changed. */
export type Piece = { text: string; marked: boolean };

export type DiffRow =
  { kind: "same"; text: string } | { kind: "gone" | "added"; text: string; pieces: Piece[] | null };

/** A run of lines that stayed, folded into one button until it is pressed. */
export type DiffFold = { kind: "fold"; rows: DiffRow[] };

/** A run that stayed folds only when it is longer than this. */
export const FOLD_OVER = 4;

/** A walk that would take more steps than this reads as all new. */
const MAX_STEPS = 2000;

/** The lines of a text. An empty text has none, rather than one empty line. */
export function linesOf(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

type Op = "same" | "gone" | "added";

/**
 * The shortest walk from `a` to `b` (Myers), as one op per item: `same`
 * steps both, `gone` steps `a`, `added` steps `b`. Null when the two are too
 * far apart to be worth walking, and the caller says all of it changed.
 */
function walk<T>(a: T[], b: T[], maxSteps: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    if (d > maxSteps) return null;
    /* Only k in -d..d is read back at this step, so only that much is
       kept: a whole copy each step reached hundreds of megabytes. */
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const kept = trace[d];
    // The copy of step d starts at k = -d; step 0 kept only k = 0.
    const v = (at: number) => kept[at + d] ?? 0;
    const k = x - y;
    const prevK = k === -d || (k !== d && v(k - 1) < v(k + 1)) ? k + 1 : k - 1;
    const prevX = v(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push("same");
      x--;
      y--;
    }
    if (d > 0) ops.push(x === prevX ? "added" : "gone");
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/** The ops of two lists, or every item gone and then every item added. */
function opsOf<T>(a: T[], b: T[], maxSteps: number): Op[] {
  // The same head and tail need no walk, and most edits touch the middle.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const mid = walk(midA, midB, maxSteps) ?? [
    ...midA.map((): Op => "gone"),
    ...midB.map((): Op => "added"),
  ];
  return [
    ...Array.from({ length: head }, (): Op => "same"),
    ...mid,
    ...Array.from({ length: tail }, (): Op => "same"),
  ];
}

/** Words, runs of space and single marks, so a change marks whole words. */
function tokens(line: string): string[] {
  return line.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

/** Adjacent pieces of one kind become one, so a mark is one block. */
function joined(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const piece of pieces) {
    const last = out.at(-1);
    if (last && last.marked === piece.marked) last.text += piece.text;
    else out.push({ ...piece });
  }
  return out;
}

/**
 * The words that changed between a line taken away and the line added in
 * its place. Null when the two share too little for marks to help: a line
 * rewritten whole is read whole, not as a scatter of marks.
 */
export function wordMarks(was: string, now: string): { was: Piece[]; now: Piece[] } | null {
  const a = tokens(was);
  const b = tokens(now);
  const ops = opsOf(a, b, 200);
  const wasPieces: Piece[] = [];
  const nowPieces: Piece[] = [];
  let i = 0;
  let j = 0;
  let kept = 0;
  for (const op of ops) {
    if (op === "same") {
      kept += a[i].trim() ? a[i].length : 0;
      wasPieces.push({ text: a[i++], marked: false });
      nowPieces.push({ text: b[j++], marked: false });
    } else if (op === "gone") wasPieces.push({ text: a[i++], marked: true });
    else nowPieces.push({ text: b[j++], marked: true });
  }
  const shorter = Math.min(was.replace(/\s/g, "").length, now.replace(/\s/g, "").length);
  if (shorter === 0 || kept * 2 < shorter) return null;
  return { was: joined(wasPieces), now: joined(nowPieces) };
}

/** Every line of the two texts, as one column: stayed, taken away, added. */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = linesOf(before);
  const b = linesOf(after);
  const ops = opsOf(a, b, MAX_STEPS);
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  let gone: string[] = [];
  let added: string[] = [];
  const flush = () => {
    gone.forEach((text, n) => {
      const pair = added[n];
      const marks = pair === undefined ? null : wordMarks(text, pair);
      rows.push({ kind: "gone", text, pieces: marks?.was ?? null });
    });
    added.forEach((text, n) => {
      const pair = gone[n];
      const marks = pair === undefined ? null : wordMarks(pair, text);
      rows.push({ kind: "added", text, pieces: marks?.now ?? null });
    });
    gone = [];
    added = [];
  };
  for (const op of ops) {
    if (op === "same") {
      flush();
      rows.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (op === "gone") gone.push(a[i++]);
    else added.push(b[j++]);
  }
  flush();
  return rows;
}

/**
 * The rows as drawn: a run of more than `FOLD_OVER` lines that stayed keeps
 * one line on each side and folds the rest into one button.
 */
export function foldRows(rows: DiffRow[]): (DiffRow | DiffFold)[] {
  const out: (DiffRow | DiffFold)[] = [];
  let run: DiffRow[] = [];
  const close = () => {
    if (run.length > FOLD_OVER) {
      out.push(run[0], { kind: "fold", rows: run.slice(1, -1) }, run[run.length - 1]);
    } else out.push(...run);
    run = [];
  };
  for (const row of rows) {
    if (row.kind === "same") run.push(row);
    else {
      close();
      out.push(row);
    }
  }
  close();
  return out;
}

/** How many lines went and how many came. */
export function countRows(rows: DiffRow[]): { gone: number; added: number } {
  let gone = 0;
  let added = 0;
  for (const row of rows) {
    if (row.kind === "gone") gone++;
    else if (row.kind === "added") added++;
  }
  return { gone, added };
}

const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

/** The head of the changes: `2 lines taken away · 5 added`. */
export function countSaid({ gone, added }: { gone: number; added: number }): string {
  if (gone && added) return `${lines(gone)} taken away · ${added} added`;
  if (gone) return `${lines(gone)} taken away`;
  if (added) return `${lines(added)} added`;
  return "No line changed";
}

/** The fold's words: `9 lines the same`. */
export function foldSaid(n: number): string {
  return `${lines(n)} the same`;
}
