import { AppBarBlank } from "@/components/ui/AppBar";
import { PageShell } from "@/components/ui/Layout";
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <AppBarBlank />
      <PageShell width="narrow">
        <Skeleton width={120} height={22} />
        <Skeleton height={220} radius={10} />
        <Skeleton height={180} radius={10} />
      </PageShell>
    </div>
  );
}
