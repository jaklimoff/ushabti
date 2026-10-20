"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBoard } from "@/components/board/store";
import { canStartAs, readWhens, whenSaid } from "@/lib/when";
import { NO_VALUE_KEY, type PropertyDTO, type TaskValue, type When } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Form";
import { ConfirmRow } from "@/components/ui/ConfirmRow";
import { RolePanel, RoleRow } from "./RolePanel";
import { StartsAs } from "./StartsAs";
import { useWhenWrites } from "./useWhenWrite";
import styles from "./settings.module.css";

/**
 * The types, set on the select that holds them: every property down the
 * side, every type across the top, and a tick where the property shows.
 *
 * It stores nothing of its own. A tick is a reading of the property's `when`,
 * and a press writes that rule through the one hook every page uses, which
 * asks first with the count. The question sits under the grid, one at a time.
 */
export function TypesGrid({ type, canEdit }: { type: PropertyDTO; canEdit: boolean }) {
  const { data, send, refresh, notify } = useBoard();
  const router = useRouter();
  const writes = useWhenWrites();
  const [sending, setSending] = useState(false);
  /* The cell whose start is open, as property and type. */
  const [open, setOpen] = useState<{ propertyId: string; optionId: string } | null>(null);
  const read = readWhens(data.properties);
  const rows = read.filter((p) => p.id !== type.id);
  const all = type.options.map((o) => o.id);
  const opened = open && rows.find((p) => p.id === open.propertyId);
  const openedType = open && type.options.find((o) => o.id === open.optionId);
  const askedOf = writes.asking && rows.find((p) => p.id === writes.asking?.propertyId);

  async function turnOff() {
    if (sending) return;
    setSending(true);
    try {
      await send.patch(`/api/projects/${data.project.id}`, { typeBy: null });
      await refresh();
      router.refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSending(false);
    }
  }

  function press(property: PropertyDTO, optionId: string, on: boolean) {
    const when = property.config.when;
    /* No rule is every type, and "nothing yet" too: taking one type away
       leaves an untyped task as it was. */
    const shown = when ? when.optionIds : [...all, NO_VALUE_KEY];
    const next = on ? [...shown, optionId] : shown.filter((id) => id !== optionId);
    if (on && all.every((id) => next.includes(id))) return void writes.write(property, null);
    const rule: When = { propertyId: type.id, optionIds: next };
    if (on) return writes.save(property, rule);
    if (open?.propertyId === property.id && open.optionId === optionId) setOpen(null);
    void writes.write(property, rule);
  }

  return (
    <RolePanel label="The types">
      <RoleRow label="The types" note="A task shows the properties its type ticks.">
        {canEdit ? (
          <Checkbox
            role="switch"
            label="Each option is a type"
            checked
            disabled={sending}
            onChange={() => void turnOff()}
          />
        ) : (
          <span>Each option of {type.name} is a type.</span>
        )}
      </RoleRow>
      {type.options.length > 0 && rows.length > 0 && (
        <div className={styles.typeGridScroll} data-testid="types-grid">
          <table className={styles.typeGrid}>
            <thead>
              <tr>
                <th scope="col" className={styles.typeGridHead}>
                  Shows on
                </th>
                {type.options.map((o) => (
                  <th key={o.id} scope="col" className={styles.typeGridType}>
                    <span className={styles.typeDot} style={{ background: o.color }} />
                    {o.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((property) => {
                const when = property.config.when;
                if (when && when.propertyId !== type.id)
                  return (
                    <tr key={property.id} className={styles.typeGridRuled}>
                      <th scope="row" className={styles.typeGridName}>
                        {property.name}
                      </th>
                      <td colSpan={type.options.length}>{whenSaid(when, read)}</td>
                    </tr>
                  );
                const ticked = when ? when.optionIds : all;
                const tickedTypes = all.filter((id) => ticked.includes(id));
                return (
                  <tr key={property.id}>
                    <th scope="row" className={styles.typeGridName}>
                      {property.name}
                    </th>
                    {type.options.map((o) => {
                      const on = ticked.includes(o.id);
                      /* The last type is not taken away here: what shows then
                         is a question for the property's own row. */
                      const last = on && tickedTypes.length === 1;
                      const starts = property.config.defaults?.[o.id] ?? null;
                      const isOpen = open?.propertyId === property.id && open.optionId === o.id;
                      return (
                        <td key={o.id} className={styles.typeGridCell}>
                          <Checkbox
                            label=""
                            aria-label={`${property.name} on ${o.name}`}
                            checked={on}
                            disabled={!canEdit || last}
                            onChange={() => press(property, o.id, !on)}
                          />
                          {on && canStartAs(property.type) && (
                            <StartsSaid
                              said={startsSaid(property, starts)}
                              label={`${property.name} on ${o.name} starts`}
                              open={isOpen}
                              canEdit={canEdit}
                              onPress={() =>
                                setOpen(isOpen ? null : { propertyId: property.id, optionId: o.id })
                              }
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && opened && openedType && canStartAs(opened.type) && (
        <div className={styles.typeGridStarts} data-testid="types-grid-starts">
          <span>
            <b>{opened.name}</b> on <b>{openedType.name}</b>
          </span>
          <StartsAs
            key={`${opened.id}:${openedType.id}`}
            property={opened}
            optionId={openedType.id}
            canEdit
          />
          <Button variant="text" onClick={() => setOpen(null)}>
            Done
          </Button>
        </div>
      )}
      {writes.asking && askedOf && (
        <div data-testid="when-confirm">
          <ConfirmRow
            question={writes.asking.question}
            confirmLabel="Yes, hide"
            onConfirm={writes.confirm}
            onCancel={writes.cancel}
          />
        </div>
      )}
      {canEdit && (
        <span className={styles.rolePanelRowNote}>
          Unticking takes values away. You are asked first, with the count.
        </span>
      )}
    </RolePanel>
  );
}

/** "starts empty", or "starts High": what a new task of this type gets. */
function StartsSaid({
  said,
  label,
  open,
  canEdit,
  onPress,
}: {
  said: string | null;
  label: string;
  open: boolean;
  canEdit: boolean;
  onPress: () => void;
}) {
  const words =
    said === null ? (
      <>starts empty</>
    ) : (
      <>
        starts <b>{said}</b>
      </>
    );
  if (!canEdit) return <span className={styles.typeGridStartsSaid}>{words}</span>;
  return (
    <button
      type="button"
      className={styles.typeGridStartsSaid}
      aria-label={`${label} ${said ?? "empty"}`}
      aria-expanded={open}
      onClick={onPress}
    >
      {words}
    </button>
  );
}

/** A default in the words a cell can hold, or null for none. */
function startsSaid(property: PropertyDTO, value: TaskValue | null): string | null {
  if (value === null || value === "" || value === false) return null;
  if (Array.isArray(value)) {
    const names = value.map((id) => property.options.find((o) => o.id === id)?.name ?? id);
    return names.length ? names.join(", ") : null;
  }
  if (value === true) return "ticked";
  if (typeof value === "string") return property.options.find((o) => o.id === value)?.name ?? value;
  return String(value);
}
