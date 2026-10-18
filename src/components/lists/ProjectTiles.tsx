"use client";

import { PROJECT_INK, keyTint } from "@/lib/colors";
import styles from "./lists.module.css";

export type TileProject = { id: string; key: string; name: string; color: string };

/**
 * The projects as tiles, three to a row as on Home. A new list picks with
 * them and the editor adds with them, so the same choice looks the same one
 * click apart. A tile is grey at rest, takes the project's tint under the
 * pointer, and wears its colour when picked.
 *
 * `adds` is the editor's: a tile there adds the project at once, so it says
 * `+` instead of a tick and is never pressed.
 */
export function ProjectTiles({
  projects,
  picked = () => false,
  onPick,
  adds = false,
  disabled = false,
  testId = "list-tile",
}: {
  projects: TileProject[];
  picked?: (id: string) => boolean;
  onPick: (id: string) => void;
  adds?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div className={styles.tiles}>
      {projects.map((p) => {
        const on = picked(p.id);
        const tint = keyTint(p.color);
        return (
          <button
            key={p.id}
            type="button"
            className={styles.tile}
            aria-pressed={adds ? undefined : on}
            aria-label={adds ? `Add ${p.key} · ${p.name}` : undefined}
            disabled={disabled}
            data-testid={testId}
            style={
              {
                "--project": p.color,
                "--project-ink": PROJECT_INK,
                "--key-tint": tint.background,
                "--key-tint-ink": tint.color,
              } as React.CSSProperties
            }
            onClick={() => onPick(p.id)}
          >
            <span className={styles.tileKey}>{p.key}</span>
            <span className={styles.tileName}>{p.name}</span>
            <span className={adds ? styles.plus : styles.tick} aria-hidden="true">
              {adds ? "+" : on ? "✓" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
