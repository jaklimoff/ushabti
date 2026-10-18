import { AppBarBlank } from "@/components/ui/AppBar";
import { PageShell } from "@/components/ui/Layout";
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <AppBarBlank />
      <PageShell width="content">
        <Skeleton width={120} height={22} />
        <Skeleton height={260} radius={10} />
      </PageShell>
    </div>
  );
}
