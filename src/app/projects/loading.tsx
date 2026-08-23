import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div
        style={{
          height: 46,
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-top)",
        }}
      />
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "40px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <Skeleton width={120} height={22} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))",
            gap: 10,
          }}
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={96} radius={10} />
          ))}
        </div>
      </div>
    </div>
  );
}
