"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useBoard } from "@/components/board/store";
import { api } from "@/lib/client";
import { canManage } from "@/lib/roles";
import { editedText } from "@/lib/leave";
import { fallbackRow, KIND_OF_TYPE, setCardPlace, viewOf } from "@/lib/card-view";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, NameInput, Select } from "@/components/ui/Form";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { Card, Foot, Note, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { useDismiss } from "@/components/ui/useDismiss";
import { PALETTE } from "@/lib/colors";
import {
  GROUPABLE_TYPES,
  PROPERTY_TYPES,
  PROPERTY_TYPE_HINT,
  PROPERTY_TYPE_LABEL,
  type PropertyDTO,
  type PropertyType,
} from "@/lib/types";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

export function PropertiesPanel() {
  const { data, addProperty, moveProperty } = useBoard();
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("select");
  const [options, setOptions] = useState("");
  const canEdit = canManage(data.project.role);

  /* The grip is the only thing that lifts a row, so the name box and the
     buttons on it still take a caret and a click. Space lifts, the arrows
     move, Space puts it down: that is the route the up and down buttons gave.
     The same 4 px as the views rows, because it is one settings page. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* The drag names the row it landed on, never a rank. The store works the
     neighbour out, as it does for a view, and the rank is made on the server
     under the project lock. */
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void moveProperty(String(active.id), String(over.id));
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const list =
      type === "select" || type === "multi_select"
        ? options
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    setName("");
    setOptions("");
    await addProperty(trimmed, type, list);
  }

  return (
    <>
      <PageHead
        title="Properties"
        note="Every field on a task lives here. Nothing is built in — rename, recolour or delete whatever you like. Drag a property by its grip to change the order of the fields in the task panel."
      />

      <Card>
        {/* One column of rows, so dnd-kit's own answer is the right one.
            Nothing here is as tall as a board column. */}
        <DndContext
          id="ushabti-property-rows"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={data.properties.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {data.properties.map((property) => (
              <PropertyRow key={property.id} property={property} canEdit={canEdit} />
            ))}
          </SortableContext>
        </DndContext>

        <Foot>
          <Input
            style={{ width: 148 }}
            aria-label="New property name"
            value={name}
            placeholder="New property name"
            onChange={(e) => setName(e.target.value)}
          />
          <Select
            aria-label="Type of the new property"
            value={type}
            onChange={(e) => setType(e.target.value as PropertyType)}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
          {(type === "select" || type === "multi_select") && (
            <Input
              style={{ flex: 1, minWidth: 160 }}
              value={options}
              placeholder="Options, separated by commas"
              onChange={(e) => setOptions(e.target.value)}
            />
          )}
          <Button onClick={() => void create()}>Add property</Button>
          <span style={{ width: "100%" }}>
            <Note>{PROPERTY_TYPE_HINT[type]}</Note>
          </span>
        </Foot>
      </Card>
    </>
  );
}

function PropertyRow({ property, canEdit }: { property: PropertyDTO; canEdit: boolean }) {
  const { cardItems, setCardView, patchProperty, deleteProperty, addOption, notify } = useBoard();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: property.id,
    transition: { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });
  const [name, setName] = useState(property.name);
  /* The box mirrors what is saved, and the mirror goes stale when somebody
     else changes it. Only what this tab typed may be written back. */
  const [typed, setTyped] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const confirm = useConfirm();
  /* How many values the delete takes. Null while the server is counting. */
  const [values, setValues] = useState<number | null>(null);
  /* Where a property sits on a card belongs to the card view, so this reads
     from there and writes there. This page keeps the short answer; the card
     view page has the long one. */
  const showOnCard = cardItems.find((i) => i.id === property.id)?.place !== "off";

  /* The name saves on blur, and a closed tab sends no blur. */
  const nameEdit = typed ? editedText(name, property.name) : null;
  useSaveOnLeave(() =>
    nameEdit
      ? { method: "PATCH", url: `/api/properties/${property.id}`, body: { name: nameEdit } }
      : null,
  );

  /* How much a delete costs, in the numbers the person can check. The count
     comes from the server because the cascade does not care whether a task is
     on a board: the values of an archived task go the same way. It is asked
     here, when the row is pressed, so no board read pays for it. */
  async function ask() {
    setValues(null);
    confirm.ask();
    try {
      const answer = await api.get<{ values: number }>(`/api/properties/${property.id}/count`);
      setValues(answer.values);
    } catch {
      /* The question cannot name what it costs, so it is not asked. The row
         comes back, and it says why rather than closing for no reason. */
      confirm.cancel();
      notify("Could not count what goes with it.");
    }
  }

  const cost = [
    property.options.length
      ? `${property.options.length} ${property.options.length === 1 ? "option" : "options"}`
      : null,
    values === null ? null : `${values} ${values === 1 ? "value" : "values"}`,
  ]
    .filter(Boolean)
    .join(" and ");

  if (confirm.asking) {
    return (
      <div className={styles.propBox} data-testid="property-box">
        <ConfirmRow
          question={
            values === null
              ? `Delete ${property.name}? Counting what goes with it…`
              : `Delete ${property.name}? ${cost} go with it.`
          }
          /* Until the count lands the question does not name its cost, and a
             question that names no cost must not be answerable. */
          pending={values === null}
          onConfirm={() => confirm.confirm(() => void deleteProperty(property.id))}
          onCancel={confirm.cancel}
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`${styles.propBox} ${isDragging ? styles.rowLifted : ""}`}
      data-testid="property-box"
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined,
      }}
    >
      <div className={styles.propHead}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={styles.grip}
          aria-label={`Move ${property.name}`}
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </button>
        <div className={styles.propName}>
          <NameInput
            aria-label={`Name of the ${property.name} property`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTyped(true);
            }}
            onBlur={() => {
              setTyped(false);
              if (nameEdit) void patchProperty(property.id, { name: nameEdit });
              else setName(property.name);
            }}
          />
        </div>
        <div className={styles.propTags}>
          <Tag>{PROPERTY_TYPE_LABEL[property.type]}</Tag>
          {GROUPABLE_TYPES.includes(property.type) && (
            <Tag title="A view can use this property for its columns">groupable</Tag>
          )}
        </div>
        <div className={styles.propTools}>
          <button
            type="button"
            className={`${styles.cardToggle} ${showOnCard ? styles.cardToggleOn : ""}`}
            aria-label={`${showOnCard ? "Hide" : "Show"} ${property.name} on the card`}
            aria-pressed={showOnCard}
            onClick={() => {
              const view = viewOf(cardItems);
              void setCardView(
                showOnCard
                  ? setCardPlace(view, property.id, "off")
                  : {
                      ...view,
                      rows: {
                        ...view.rows,
                        [property.id]: fallbackRow(KIND_OF_TYPE[property.type]),
                      },
                    },
              );
            }}
          >
            On card {showOnCard ? "◉" : "○"}
          </button>
          {canEdit && (
            <IconButton
              danger
              label={`Delete the property ${property.name}`}
              title="Delete this property and every value in it"
              onClick={() => void ask()}
            >
              ✕
            </IconButton>
          )}
        </div>
      </div>

      {(property.type === "select" || property.type === "multi_select") && (
        <div className={styles.options}>
          {property.options.map((option) => (
            <OptionChip key={option.id} option={option} canEdit={canEdit} />
          ))}
          {adding ? (
            <Input
              style={{ height: 24, width: 130 }}
              autoFocus
              value={draft}
              placeholder="Option name"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                const value = draft.trim();
                setDraft("");
                setAdding(false);
                if (value) void addOption(property.id, value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setDraft("");
                  setAdding(false);
                }
              }}
            />
          ) : (
            <button type="button" className={styles.optionAdd} onClick={() => setAdding(true)}>
              + option
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OptionChip({
  option,
  canEdit,
}: {
  option: PropertyDTO["options"][number];
  canEdit: boolean;
}) {
  const { patchOption, deleteOption } = useBoard();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLSpanElement>(() => setOpen(false), open);

  return (
    <span className={styles.option} ref={ref}>
      {/* The colour is the longhand, because on a phone the button holds a
          24 px square and clips the colour to the middle of it. The
          `background` shorthand would put that clip back to the whole button. */}
      <button
        type="button"
        className={styles.swatchBtn}
        style={{ backgroundColor: option.color }}
        aria-label={`Colour of ${option.name}`}
        title="Colour"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <span className={styles.swatchPop} role="listbox" aria-label={`Colour of ${option.name}`}>
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              role="option"
              aria-selected={color === option.color}
              aria-label={color}
              title={color}
              className={`${styles.swatchChip} ${color === option.color ? styles.swatchChipOn : ""}`}
              style={{ background: color }}
              onClick={() => {
                setOpen(false);
                if (color !== option.color) void patchOption(option.id, { color });
              }}
            />
          ))}
        </span>
      )}
      <OptionName option={option} />
      {canEdit && (
        <button
          type="button"
          className={styles.optionRemove}
          aria-label={`Delete the option ${option.name}`}
          title="Delete option"
          onClick={() => void deleteOption(option.id)}
        >
          ✕
        </button>
      )}
    </span>
  );
}

/** Keyed on the option, so a rename from somebody else does not fight the box. */
function OptionName({ option }: { option: PropertyDTO["options"][number] }) {
  const { patchOption } = useBoard();
  const box = useRef<HTMLInputElement>(null);
  /* Only what this tab typed may be written back. The box below is put right
     from the saved name while nobody is in it, but a box somebody is sitting
     in keeps whatever it held, and that is the stale one. */
  const [typed, setTyped] = useState(false);

  /* The box holds its words itself, so the leave asks the box rather than a
     render that may be one keystroke old. */
  useSaveOnLeave(() => {
    const edit = typed ? editedText(box.current?.value ?? "", option.name) : null;
    return edit
      ? { method: "PATCH", url: `/api/options/${option.id}`, body: { name: edit } }
      : null;
  });

  useEffect(() => {
    if (box.current && document.activeElement !== box.current) box.current.value = option.name;
  }, [option.name]);

  return (
    <input
      ref={box}
      className={styles.optionInput}
      aria-label={`Name of the option ${option.name}`}
      defaultValue={option.name}
      onChange={() => setTyped(true)}
      onBlur={(e) => {
        setTyped(false);
        const edit = editedText(e.target.value, option.name);
        if (edit) void patchOption(option.id, { name: edit });
        else e.target.value = option.name;
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
