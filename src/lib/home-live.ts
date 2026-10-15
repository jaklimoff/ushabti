/*
 * When Home reads itself again. Home has one doorbell for every project, so a
 * busy afternoon rings it many times a second; a read is a whole server
 * render of every card, so the rings are gathered and answered with one.
 *
 * A hidden tab reads nothing. It remembers that it was rung and reads once
 * when it is shown again, so a tab left open in the background all day costs
 * the server nothing.
 */

/** How long a ring waits for the rest of its burst. */
export const BURST_MS = 400;

/**
 * How often Home reads while an agent is at work. A run falls silent when
 * time passes and nothing rings for it, so the page goes and looks: at half a
 * minute, a run that falls silent shows within one.
 */
export const SILENCE_CHECK_MS = 30_000;

export type HomeReader = {
  /** Something changed somewhere. */
  ring: () => void;
  /** The tab was shown or hidden. */
  shown: () => void;
  stop: () => void;
};

export function homeReader({
  read,
  hidden,
  wait = BURST_MS,
}: {
  read: () => void;
  hidden: () => boolean;
  wait?: number;
}): HomeReader {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let owed = false;

  const fire = () => {
    timer = null;
    if (hidden()) {
      owed = true;
      return;
    }
    read();
  };

  return {
    ring() {
      if (hidden()) {
        owed = true;
        return;
      }
      if (timer) return;
      timer = setTimeout(fire, wait);
    },
    shown() {
      if (hidden() || !owed) return;
      owed = false;
      if (!timer) timer = setTimeout(fire, 0);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
