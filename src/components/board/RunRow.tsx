"use client";

import type { AgentRunDTO } from "@/lib/types";
import { isOpen, lifeOf, runClock, runIsStill, runLine } from "@/lib/run-state";
import { Avatar } from "@/components/ui/Avatar";
import { useNow } from "@/components/ui/useElapsed";
import styles from "./board.module.css";

/**
 * What a run is doing now, read against a clock that ticks while it is open.
 * The card's strip and the panel's line both ask here, so the two say the
 * same thing at the same moment.
 */
export function useRunNow(run: AgentRunDTO) {
  const now = useNow(isOpen(run.status));
  return { life: lifeOf(run, now), clock: runClock(run, now), still: runIsStill(run, now) };
}

/**
 * Who, what and how long: the one line a run has. The card draws it as its
 * strip and the panel head as the way to the Agent tab, so a run reads in
 * one set of words wherever it shows. `line` is there for the card, which
 * says something else while a card is held over it.
 */
export function RunRow({
  run,
  clock,
  line = runLine(run),
}: {
  run: AgentRunDTO;
  clock: { text: string; stale: boolean };
  line?: string;
}) {
  return (
    <div className={styles.runStripRow}>
      {/* The face and colour of the agent, so the one at work is not
          mistaken for the person the task is assigned to. A run that waits
          keeps the face and lends the name's room to its question. */}
      <span
        className={styles.runAgent}
        style={{ color: `color-mix(in srgb, ${run.agent.color} 62%, var(--text-2))` }}
      >
        <Avatar
          name={run.agent.name}
          color={run.agent.color}
          emoji={run.agent.emoji}
          kind="agent"
          size={14}
        />
        <span className={styles.runName}>{run.agent.name}</span>
      </span>
      {/* The line is cut to fit, so the whole of it is a hover away. */}
      <span className={styles.runText} data-testid="card-run-step" title={line}>
        {line}
      </span>
      <span
        className={`${styles.runTime} ${clock.stale ? styles.runTimeStale : ""}`}
        data-testid="card-run-time"
      >
        {clock.text}
      </span>
    </div>
  );
}
