"use client";

import { listeningAgents } from "@/lib/presence";
import { Avatar } from "@/components/ui/Avatar";
import { useNow } from "@/components/ui/useElapsed";
import { useBoard } from "./store";
import styles from "./board.module.css";

/**
 * Puts the tip under its face and inside the window. The agents sit near the
 * right end of a wide bar and near the left end of a phone's, so no one side
 * to grow from fits both. The tip is laid out while it is hidden, which is
 * why it can be measured before it shows.
 */
function placeTip(host: HTMLElement) {
  const tip = host.querySelector<HTMLElement>("[data-testid='listening-tip']");
  if (!tip) return;
  const face = host.getBoundingClientRect();
  const margin = 8;
  const centred = face.left + face.width / 2 - tip.offsetWidth / 2;
  const left = Math.max(margin, Math.min(centred, window.innerWidth - margin - tip.offsetWidth));
  tip.style.left = `${left - face.left}px`;
  tip.style.right = "auto";
}

/**
 * The agents that hold this board's stream open, which is to say the agents
 * that will hear a task the moment somebody writes one. An agent that is away
 * draws nothing: an idle board says nothing about machines at all.
 *
 * The answer is a lease, so it can change while the board does not. The clock
 * only runs while some agent has said it listens.
 */
export function Listening() {
  const { data } = useBoard();
  const someone = data.members.some((m) => m.kind === "agent" && m.listeningAt);
  const now = useNow(someone);
  const agents = listeningAgents(data.members, now);
  if (!agents.length) return null;

  return (
    <span className={styles.listening} data-testid="listening-agents">
      {agents.map((agent) => (
        /* Every agent draws the same ◆, so the name is the only thing that
           tells two apart. A native title waits a second, never shows on
           focus and names nothing to a screen reader, so the tip is our own
           and the face carries no title to draw a second one. */
        <span
          key={agent.id}
          className={styles.listener}
          data-testid="listening-agent"
          data-name={agent.name}
          role="img"
          aria-label={`${agent.name} is listening`}
          tabIndex={0}
          onPointerEnter={(e) => placeTip(e.currentTarget)}
          onFocus={(e) => placeTip(e.currentTarget)}
        >
          <Avatar name={agent.name} color={agent.color} size={18} kind="agent" live title={null} />
          <span className={styles.listenerTip} data-testid="listening-tip" aria-hidden="true">
            <span className={styles.listenerName}>{agent.name}</span>
            <span>Listening. It hears a new task at once.</span>
          </span>
        </span>
      ))}
    </span>
  );
}
