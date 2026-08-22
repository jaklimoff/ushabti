"use client";

import { initials } from "@/lib/colors";

export function Avatar({
  name,
  color,
  size = 18,
  title,
  kind = "human",
  live = false,
}: {
  name: string;
  color: string;
  size?: number;
  title?: string;
  kind?: "human" | "agent";
  /** An agent with an open run breathes, so the board shows who is at work. */
  live?: boolean;
}) {
  const face = (
    <span
      title={title ?? name}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: "50%",
        background: color,
        color: kind === "agent" ? "#05242b" : "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-mono)",
        fontWeight: 500,
        fontSize: Math.max(7.5, size * (kind === "agent" ? 0.5 : 0.44)),
        letterSpacing: "0.02em",
        userSelect: "none",
        position: "relative",
      }}
    >
      {kind === "agent" ? "◆" : initials(name)}
    </span>
  );

  if (!live) return face;

  return (
    <span
      style={{
        position: "relative",
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        display: "inline-flex",
      }}
      data-testid="agent-live-ring"
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: `1px solid ${color}`,
          animation: "ushabti-ring 1.8s ease-out infinite",
          pointerEvents: "none",
        }}
      />
      {face}
    </span>
  );
}
