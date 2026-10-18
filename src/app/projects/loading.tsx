import { AppBarBlank } from "@/components/ui/AppBar";
import { PageShell } from "@/components/ui/Layout";
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <AppBarBlank />
      <PageShell width="wide">
        <Skeleton width={120} height={22} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(340px, 100%), 1fr))",
            gap: 10,
          }}
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={96} radius={10} />
          ))}
        </div>
      </PageShell>
    </div>
  );
}
