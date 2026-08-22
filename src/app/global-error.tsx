"use client";

/**
 * The root layout failed, so there is no layout to render into: this file
 * ships its own html and body, and cannot use the shared components.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0b0d",
          color: "#e8e9ec",
          fontFamily: "system-ui, sans-serif",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 380 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Ushabti could not start this page</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "#8b919b" }}>
            {error.digest ? (
              <>
                Look for <code style={{ color: "#a4aab3" }}>{error.digest}</code> in the server log.
              </>
            ) : (
              "Look at the server log."
            )}
          </div>
          <button
            onClick={reset}
            style={{
              alignSelf: "center",
              padding: "6px 13px",
              borderRadius: 5,
              border: 0,
              background: "#3fb0c8",
              color: "#05242b",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
