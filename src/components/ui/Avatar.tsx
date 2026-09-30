"use client";

import { ink, initials } from "@/lib/colors";

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export function Avatar({
  name,
  color,
  emoji = null,
  size = 18,
  title,
  kind = "human",
  live = false,
}: {
  name: string;
  color: string;
  /** Worn instead of the initials, on the same colour. Null is the initials. */
  emoji?: string | null;
  size?: number;
  /** Null draws no title, for a caller that names the face in its own way. */
  title?: string | null;
  kind?: "human" | "agent";
  /** An agent with an open run breathes, so the board shows who is at work. */
  live?: boolean;
}) {
  const face = (
    <span
      title={title === null ? undefined : (title ?? name)}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: "50%",
        background: color,
        color: ink(color),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        ...(emoji
          ? {
              /* An emoji is drawn by the system's emoji font, which sits a
                 little high and wide; this size keeps it inside the circle. */
              fontFamily: EMOJI_FONT,
              fontSize: Math.max(8, size * 0.62),
              lineHeight: 1,
            }
          : {
              fontFamily: "var(--font-mono)",
              fontWeight: 500,
              fontSize: Math.max(7.5, size * (kind === "agent" ? 0.5 : 0.44)),
              letterSpacing: "0.02em",
            }),
        userSelect: "none",
        position: "relative",
      }}
    >
      {emoji ?? (kind === "agent" ? "◆" : initials(name))}
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
