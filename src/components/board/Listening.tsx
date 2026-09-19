"use client";

import { listeningAgents } from "@/lib/presence";
import { Avatar } from "@/components/ui/Avatar";
import { useNow } from "@/components/ui/useElapsed";
import { useBoard } from "./store";
import styles from "./board.module.css";

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
        <span key={agent.id} data-testid="listening-agent" data-name={agent.name}>
          <Avatar
            name={agent.name}
            color={agent.color}
            size={18}
            kind="agent"
            live
            title={`${agent.name} is listening. It hears a new task at once.`}
          />
        </span>
      ))}
    </span>
  );
}
