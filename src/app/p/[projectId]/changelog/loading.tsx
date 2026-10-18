import { AppBarBlank } from "@/components/ui/AppBar";
import { PageShell } from "@/components/ui/Layout";
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <AppBarBlank />
      <PageShell width="content">
        {/* The title and its lead, as `PageHead` draws them. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton width={120} height={22} />
          <Skeleton width="min(420px, 100%)" height={14} />
        </div>
        <Skeleton height={260} radius={10} />
      </PageShell>
    </div>
  );
}
