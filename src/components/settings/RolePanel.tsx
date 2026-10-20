import { Label } from "@/components/ui/Form";
import styles from "./settings.module.css";

/**
 * What a property does for the whole board, set on the property itself. It
 * sits under the options as an inset block, one row per setting, so each
 * role reads the same way whichever property plays it.
 */
export function RolePanel({
  label,
  note,
  children,
}: {
  label: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.rolePanelWrap}>
      <div className={styles.rolePanel} role="group" aria-label={label} data-testid="role-panel">
        {children}
      </div>
      {note && <span className={styles.rolePanelNote}>{note}</span>}
    </div>
  );
}

/** One setting of a role: its label in a fixed column, the control, and a note under it. */
export function RoleRow({
  label,
  note,
  children,
}: {
  label: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.rolePanelRow}>
      <Label className={styles.rolePanelLabel}>{label}</Label>
      <div className={styles.rolePanelControl}>
        {children}
        {note && <span className={styles.rolePanelRowNote}>{note}</span>}
      </div>
    </div>
  );
}
