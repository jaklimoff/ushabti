import { AppBarBlank } from "@/components/ui/AppBar";
import { Skeleton } from "@/components/ui/Skeleton";
import styles from "@/components/settings/settings.module.css";

/* The rail as it will arrive: its groups and their items, so the page does
   not jump when the real one lands. A member sees one group fewer. */
const GROUPS = [2, 4, 2];

export default function Loading() {
  return (
    <div className={styles.page}>
      <AppBarBlank />
      <div className={styles.shell}>
        <div className={`${styles.rail} ${styles.railLoading}`} aria-hidden="true">
          {GROUPS.map((count, g) => (
            <div key={g} className={styles.railGroup}>
              <span className={styles.railGroupTitle}>
                <Skeleton width={56} height={10} />
              </span>
              {Array.from({ length: count }, (_, i) => (
                <span key={i} className={styles.railItem}>
                  <Skeleton width={70 + ((g + i) % 3) * 14} height={10} />
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className={styles.body}>
          <Skeleton width={160} height={22} />
          <Skeleton height={340} radius={10} />
        </div>
      </div>
    </div>
  );
}
