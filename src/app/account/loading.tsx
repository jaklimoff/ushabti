import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div
        style={{ height: 46, borderBottom: "1px solid var(--line)", background: "var(--bg-top)" }}
      />
      <div
        style={{
          maxWidth: 560,
          margin: "0 auto",
          padding: "34px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <Skeleton width={120} height={22} />
        <Skeleton height={220} radius={10} />
        <Skeleton height={180} radius={10} />
      </div>
    </div>
  );
}
