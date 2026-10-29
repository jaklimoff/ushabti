import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Form";
import styles from "./settings.module.css";

/**
 * What a property does for the whole board, set on the property itself. It
 * sits under the options as an inset block, one row per setting, so each
 * role reads the same way whichever property plays it.
 *
 * It opens on who plays the role, and off is a word, **Turn off**, at the
 * end of that line. It used to be a checkbox that was always ticked, whose
 * only press was off, and it read as a setting rather than a way to stop.
 */
export function RolePanel({
  label,
  head,
  onOff,
  offBusy = false,
  said,
  children,
}: {
  /** The group's name for a screen reader, and what Turn off names. */
  label: string;
  /** The words that say who plays the role. */
  head: React.ReactNode;
  /** Turns the role off, or asks first. Left out for somebody who may not. */
  onOff?: () => void;
  /** True while the last press has not been answered. */
  offBusy?: boolean;
  /** What the role does for the board, in one sentence under who plays it. */
  said?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.rolePanelWrap}>
      <div className={styles.rolePanel} role="group" aria-label={label} data-testid="role-panel">
        <div className={styles.rolePanelHead}>
          <span className={styles.rolePanelWords}>
            <span className={styles.rolePanelWho}>{head}</span>
            {said && <span className={styles.rolePanelSaid}>{said}</span>}
          </span>
          {onOff && (
            <Button
              variant="text"
              className={styles.rolePanelOff}
              aria-label={`Turn off ${label.replace(/^The /, "the ")}`}
              disabled={offBusy}
              onClick={onOff}
            >
              Turn off
            </Button>
          )}
        </div>
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
