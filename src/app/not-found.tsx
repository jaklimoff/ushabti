import Link from "next/link";

export default function NotFound() {
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
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 340 }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: "var(--accent)",
            color: "var(--accent-ink)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            margin: "0 auto",
          }}
        >
          U
        </div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>This page is not here</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)" }}>
          The project does not exist, or nobody has added you to it yet. Ask the owner to add your
          email in the project settings.
        </div>
        <Link href="/projects" style={{ fontSize: 12.5 }}>
          Go to your projects
        </Link>
      </div>
    </div>
  );
}
