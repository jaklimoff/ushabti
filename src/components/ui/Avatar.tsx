"use client";

import { initials } from "@/lib/colors";

export function Avatar({
  name,
  color,
  size = 18,
  title,
}: {
  name: string;
  color: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      title={title ?? name}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: "50%",
        background: color,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-mono)",
        fontWeight: 500,
        fontSize: Math.max(7.5, size * 0.44),
        letterSpacing: "0.02em",
        userSelect: "none",
      }}
    >
      {initials(name)}
    </span>
  );
}
