"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Something broke</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)" }}>
          The page could not finish loading. Try again; if it keeps happening, look at the server
          log.
        </div>
        <button
          onClick={reset}
          style={{
            alignSelf: "center",
            padding: "6px 13px",
            borderRadius: 6,
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
