import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Every route is a dynamic server component that reads Postgres before it
 * renders. Without this the browser sat on the old page and the click looked
 * like it had not landed.
 */
export default function Loading() {
  return (
    <div
      style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}
    >
      <div
        style={{ height: 46, borderBottom: "1px solid var(--line)", background: "var(--bg-top)" }}
      />
      <div style={{ height: 42, borderBottom: "1px solid var(--line-faint)" }} />
      <div style={{ flex: 1, display: "flex", gap: 10, padding: 10, overflow: "hidden" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{ flex: "0 0 272px", display: "flex", flexDirection: "column", gap: 8 }}
          >
            <Skeleton width={120} height={14} />
            <Skeleton height={64} radius={8} />
            <Skeleton height={64} radius={8} />
          </div>
        ))}
      </div>
    </div>
  );
}
