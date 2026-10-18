import { AppBarBlank } from "@/components/ui/AppBar";
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <AppBarBlank />
      <div
        style={{
          maxWidth: 1040,
          margin: "0 auto",
          padding: "34px 20px",
          display: "flex",
          gap: 40,
        }}
      >
        <div style={{ flex: "0 0 168px", display: "flex", flexDirection: "column", gap: 6 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={24} radius={5} />
          ))}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Skeleton width={160} height={22} />
          <Skeleton height={340} radius={10} />
        </div>
      </div>
    </div>
  );
}
