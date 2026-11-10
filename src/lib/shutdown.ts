/*
 * What the server does with its open streams when it is told to stop.
 *
 * Next's own SIGTERM handler closes the server and waits for every request to
 * finish, and a stream never finishes: each deploy waited out the whole grace
 * period and was killed, with whatever was half done. So every stream is
 * held here, and on SIGTERM each is ended. The browser opens a new one on the
 * next server; requests that are running finish, and Next exits. If something
 * still holds on, the process leaves after a few seconds anyway.
 */

type End = () => void;

/* Next builds the instrumentation hook and the routes into separate module
   graphs, so the one register they share has to sit on the process. */
const KEY = Symbol.for("ushabti.shutdown");
type Register = { open: Set<End>; stopping: boolean };
const held = globalThis as typeof globalThis & { [KEY]?: Register };
const register: Register = (held[KEY] ??= { open: new Set(), stopping: false });

/** How long a stop may take before the process leaves anyway. */
export const STOP_DEADLINE_MS = 5_000;

/** Whether the server was told to stop. A new stream is refused then. */
export function isStopping(): boolean {
  return register.stopping;
}

/** Holds a stream open until it closes. Gives back what lets it go. */
export function holdStream(end: End): () => void {
  register.open.add(end);
  return () => {
    register.open.delete(end);
  };
}

/** Ends every open stream. Gives back how many there were. */
export function endStreams(): number {
  register.stopping = true;
  const ends = [...register.open];
  register.open.clear();
  for (const end of ends) {
    try {
      end();
    } catch {
      /* one stream that fails to end must not keep the others open */
    }
  }
  return ends.length;
}

/**
 * Called once as the server starts. `exit` is the process's, given so a test
 * can watch it.
 */
export function onStop(
  on: (signal: "SIGTERM" | "SIGINT", listener: () => void) => void,
  exit: (code: number) => void,
  deadlineMs = STOP_DEADLINE_MS,
) {
  let done = false;
  const stop = (code: number) => () => {
    if (done) return;
    done = true;
    endStreams();
    setTimeout(() => exit(code), deadlineMs).unref?.();
  };
  on("SIGTERM", stop(143));
  on("SIGINT", stop(130));
}
