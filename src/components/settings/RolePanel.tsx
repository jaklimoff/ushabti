import { Label } from "@/components/ui/Form";
import styles from "./settings.module.css";

/**
 * What a property does for the whole board, set on the property itself. It
 * sits under the options as an inset block, one row per setting, so each
 * role reads the same way whichever property plays it.
 *
 * The role's name is already the accent tag on the property's head, so the
 * panel does not say it again. It opens on its switch and one sentence of
 * what the role does, and nothing hangs under it.
 */
export function RolePanel({
  label,
  head,
  said,
  children,
}: {
  /** The group's name for a screen reader. It is not drawn: the tag says it. */
  label: string;
  /** The switch that turns the role off, or the words that say who plays it. */
  head?: React.ReactNode;
  /** What the role does for the board, in one sentence. */
  said?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.rolePanelWrap}>
      <div className={styles.rolePanel} role="group" aria-label={label} data-testid="role-panel">
        {(head || said) && (
          <div className={styles.rolePanelHead}>
            {head}
            {said && <span className={styles.rolePanelSaid}>{said}</span>}
          </div>
        )}
        {children}
      </div>
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
