"use client";

import { type ChangeEvent, type FocusEvent, useEffect, useRef, useState } from "react";
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useBoard } from "@/components/board/store";
import { api } from "@/lib/client";
import { canManage } from "@/lib/roles";
import { editedText } from "@/lib/leave";
import { carriesDates, NOTE_MAX, optionEdit, splitShipped } from "@/lib/option-dates";
import { cadenceEdit, LENGTH_MAX, readCadence, type Cadence } from "@/lib/cadence";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox, Input, NameInput, Select, TextArea } from "@/components/ui/Form";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { Card, Foot, Note, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { useDismiss } from "@/components/ui/useDismiss";
import { PALETTE } from "@/lib/colors";
import { optionLines, OPTIONS_MAX, tooManySaid } from "@/lib/option-name";
import { keyName } from "@/lib/filters";
import { whenSaid } from "@/lib/when";
import {
  GROUPABLE_TYPES,
  hasOptions,
  isSelect,
  NO_VALUE_KEY,
  PROPERTY_TYPE_HINT,
  PROPERTY_TYPE_LABEL,
  PROPERTY_TYPES,
  type PropertyDTO,
  type PropertyType,
} from "@/lib/types";
import { PageHead } from "./SettingsShell";
import { useWhenWrite } from "./useWhenWrite";
import styles from "./settings.module.css";

/* The grip is the only thing that lifts a row or a chip, so the name boxes
   and the buttons beside them still take a caret and a click. Space lifts, the
   arrows move, Space puts it down: that is the route the up and down buttons
   gave. The same 4 px as the views rows, because it is one settings page. */
function useGripSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

export function PropertiesPanel() {
  const { data, addProperty, moveProperty } = useBoard();
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("select");
  const [options, setOptions] = useState("");
  const canEdit = canManage(data.project.role);
  const sensors = useGripSensors();
  const listed = hasOptions(type) ? optionLines(options) : [];
  const tooMany = listed.length > OPTIONS_MAX;

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
    // A list too long is refused whole, and stays in the box to be cut down.
    if (!trimmed || tooMany) return;
    const list = hasOptions(type) ? listed : undefined;
    setName("");
    setOptions("");
    await addProperty(trimmed, type, list);
  }

  return (
    <>
      <PageHead
        title="Properties"
        note="Every field on a task lives here. Nothing is built in — rename, recolour or delete whatever you like. Drag a property by its grip to change the order of the fields in the task panel, and an option by its grip to change the order of its columns and its sort."
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
            width="medium"
            aria-label="New property name"
            value={name}
            placeholder="New property name"
            onChange={(e) => setName(e.target.value)}
          />
          <Select
            aria-label="Type of the new property"
            value={type}
            onChange={(picked) => setType(picked as PropertyType)}
            options={PROPERTY_TYPES.map((t) => ({ value: t, label: PROPERTY_TYPE_LABEL[t] }))}
          />
          {hasOptions(type) && (
            <TextArea
              aria-label="Options of the new property"
              aria-invalid={tooMany}
              value={options}
              placeholder="Options, one per line"
              onChange={(e) => setOptions(e.target.value)}
            />
          )}
          {tooMany && (
            <span className={styles.keyWarn} role="alert" style={{ width: "100%" }}>
              {tooManySaid(listed.length)}
            </span>
          )}
          <Button disabled={tooMany} onClick={() => void create()}>
            Add property
          </Button>
          <span style={{ width: "100%" }}>
            <Note>{PROPERTY_TYPE_HINT[type]}</Note>
          </span>
        </Foot>
      </Card>
    </>
  );
}

function PropertyRow({ property, canEdit }: { property: PropertyDTO; canEdit: boolean }) {
  const { data, patchProperty, deleteProperty, addOption, deleteOption, moveOption, notify } =
    useBoard();
  const dated = carriesDates(property);
  /* The rule's row opens on a press, and stays while a rule is set. */
  const [whenOpen, setWhenOpen] = useState(false);
  /* Fifty old sprints must not stand before this week's, so the shipped ones
     wait behind one row. A dated select has none: its versions stay. */
  const { open: openOptions, shipped } = splitShipped(property);
  const [unfolded, setUnfolded] = useState(false);
  const optionSensors = useGripSensors();
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
  /* The option whose ✕ was pressed, and how many tasks hold it. The row of
     options becomes the question, because a chip is too small to hold one. */
  const dropConfirm = useConfirm();
  const [dropping, setDropping] = useState<PropertyDTO["options"][number] | null>(null);
  const [holders, setHolders] = useState<number | null>(null);
  /* Which question an answer belongs to. A count that lands after Cancel, or
     after the ✕ of another option, would name the wrong number, so it is
     dropped. */
  const asked = useRef(0);

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

  /* Counted the same way as the property, and for the same reason: an option
     leaves archived tasks too, and on a board grouped by this property its
     column goes with it. */
  async function askOption(option: PropertyDTO["options"][number]) {
    const mine = ++asked.current;
    setDropping(option);
    setHolders(null);
    dropConfirm.ask();
    try {
      const answer = await api.get<{ tasks: number }>(`/api/options/${option.id}/count`);
      if (asked.current === mine) setHolders(answer.tasks);
    } catch {
      if (asked.current !== mine) return;
      dropConfirm.cancel();
      notify("Could not count the tasks that hold it.");
    }
  }

  function dropAnswered() {
    asked.current++;
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
        <div className={styles.propTools} data-testid="property-tools">
          {/* Off, a select's options read as they did before they had dates.
              Off keeps the values: it hides the boxes and writes nothing.
              An iteration always carries them, so it has no switch. */}
          {property.type === "select" && (
            <Checkbox
              label="Options carry dates"
              checked={dated}
              disabled={!canEdit}
              onChange={(e) => void patchProperty(property.id, { dated: e.target.checked })}
            />
          )}
          {!property.config.when &&
            !whenOpen &&
            canEdit &&
            whenCandidates(property, data.properties).length > 0 && (
              <Button variant="text" onClick={() => setWhenOpen(true)}>
                Shown when…
              </Button>
            )}
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

      {property.type === "iteration" && <CadenceRow property={property} canEdit={canEdit} />}
      {(property.config.when || whenOpen) && (
        <WhenRow property={property} canEdit={canEdit} onClose={() => setWhenOpen(false)} />
      )}
      {hasOptions(property.type) && dropConfirm.asking && dropping && (
        <ConfirmRow
          question={
            holders === null
              ? `Delete ${dropping.name}? Counting the tasks that hold it…`
              : holders === 0
                ? `Delete ${dropping.name}? No task holds it.`
                : `Delete ${dropping.name}? ${holders} ${holders === 1 ? "task loses" : "tasks lose"} it.`
          }
          pending={holders === null}
          onConfirm={() => {
            dropAnswered();
            dropConfirm.confirm(() => void deleteOption(dropping.id));
          }}
          onCancel={() => {
            dropAnswered();
            dropConfirm.cancel();
          }}
        />
      )}
      {hasOptions(property.type) && !dropConfirm.asking && (
        <div className={`${styles.options} ${dated ? styles.optionsRows : ""}`}>
          {/* Labels wrap, so their strategy is a grid's; a select's options
              take a line each while they carry dates, so theirs is a list's. The
              drag names the chip it landed on, and the store makes the same
              move a column drag makes: no rank leaves this page. */}
          <DndContext
            id={`ushabti-options-${property.id}`}
            sensors={optionSensors}
            collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
              if (over && active.id !== over.id)
                void moveOption(String(active.id), String(over.id));
            }}
          >
            <SortableContext
              items={openOptions.map((o) => o.id)}
              strategy={dated ? verticalListSortingStrategy : rectSortingStrategy}
            >
              {openOptions.map((option) => (
                <OptionChip
                  key={option.id}
                  option={option}
                  dated={dated}
                  canEdit={canEdit}
                  onDelete={() => void askOption(option)}
                />
              ))}
            </SortableContext>
            {shipped.length > 0 && (
              <button
                type="button"
                className={styles.optionFold}
                aria-expanded={unfolded}
                onClick={() => setUnfolded((u) => !u)}
              >
                <span aria-hidden>{unfolded ? "▾" : "▸"}</span>
                {shipped.length} shipped
              </button>
            )}
            {unfolded && (
              <SortableContext
                items={shipped.map((o) => o.id)}
                strategy={verticalListSortingStrategy}
              >
                {shipped.map((option) => (
                  <OptionChip
                    key={option.id}
                    option={option}
                    dated={dated}
                    canEdit={canEdit}
                    onDelete={() => void askOption(option)}
                  />
                ))}
              </SortableContext>
            )}
          </DndContext>
          {adding ? (
            <Input
              size="sm"
              width="short"
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
  dated,
  canEdit,
  onDelete,
}: {
  option: PropertyDTO["options"][number];
  /** A Version or a Sprint has dates; a label and a Status do not. */
  dated: boolean;
  canEdit: boolean;
  /** Asks first. The row above owns the question. */
  onDelete: () => void;
}) {
  const { patchOption } = useBoard();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLSpanElement>(() => setOpen(false), open);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: option.id,
    transition: { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });

  return (
    <span
      className={`${styles.option} ${isDragging ? styles.rowLifted : ""}`}
      ref={(node) => {
        ref.current = node;
        setNodeRef(node);
      }}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined,
      }}
    >
      {/* Six dots, as on the property row: one grip reads as one gesture. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        className={`${styles.grip} ${styles.optionGrip}`}
        aria-label={`Move the option ${option.name}`}
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
      {dated && <OptionPlan option={option} canEdit={canEdit} />}
      {canEdit && (
        <button
          type="button"
          className={styles.optionRemove}
          aria-label={`Delete the option ${option.name}`}
          title="Delete option"
          onClick={onDelete}
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

/**
 * The start, the target and the note of a select's option. The shipped date
 * is written by shipping, so here it is only read, with the one way back.
 */
function OptionPlan({
  option,
  canEdit,
}: {
  option: PropertyDTO["options"][number];
  canEdit: boolean;
}) {
  const { patchOption } = useBoard();
  /* The day it shipped cannot be typed back, so Unship asks first. */
  const unship = useConfirm();
  if (unship.asking) {
    return (
      <span className={styles.optionPlan}>
        <ConfirmRow
          question={`Unship ${option.name}? Shipped ${option.shippedAt} is lost.`}
          confirmLabel="Yes, unship"
          onConfirm={() => unship.confirm(() => void patchOption(option.id, { shippedAt: null }))}
          onCancel={unship.cancel}
        />
      </span>
    );
  }
  return (
    <span className={styles.optionPlan}>
      <OptionField option={option} field="startAt" label="Start" type="date" />
      <span className={styles.optionArrow} aria-hidden>
        →
      </span>
      <OptionField option={option} field="targetAt" label="Target" type="date" />
      <OptionField option={option} field="note" label="Note" type="text" />
      {option.shippedAt && (
        <span className={styles.optionShipped}>
          Shipped {option.shippedAt}
          {/* Unship is an admin's, so a member reads the date and nothing more. */}
          {canEdit && (
            <button
              type="button"
              className={styles.optionUnship}
              aria-label={`Unship ${option.name}`}
              onClick={unship.ask}
            >
              Unship
            </button>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * One box of the plan. It saves on blur and owes its edit to a closed tab, as
 * every box of words does. The note is markdown, so it is a box that keeps
 * its lines: an input would strip them.
 */
function OptionField({
  option,
  field,
  label,
  type,
}: {
  option: PropertyDTO["options"][number];
  field: "startAt" | "targetAt" | "note";
  label: string;
  type: "date" | "text";
}) {
  const { patchOption } = useBoard();
  const box = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const saved = option[field];
  /* Only what this tab typed may be written back, as with the name. A ref
     and not state: a tab closed straight after a keystroke goes before the
     render that state would wait for. */
  const typed = useRef(false);
  /* A date box with one part cleared answers "" as an empty one does. Only
     badInput tells them apart, and a half date is not a date taken away. */
  const halfDate = () => type === "date" && box.current?.validity.badInput === true;
  /* Whether the box draws its placeholder. The box is not controlled, so
     this follows what it holds rather than what is saved. */
  const [empty, setEmpty] = useState(!saved);

  useSaveOnLeave(() => {
    if (!typed.current || halfDate()) return null;
    const edit = optionEdit(box.current?.value ?? "", saved);
    return edit === undefined
      ? null
      : { method: "PATCH", url: `/api/options/${option.id}`, body: { [field]: edit } };
  });

  useEffect(() => {
    if (box.current && document.activeElement !== box.current) {
      box.current.value = saved ?? "";
      setEmpty(!saved);
    }
  }, [saved]);

  const shared = {
    ref: box,
    "aria-label": `${label} of ${option.name}`,
    title: label,
    defaultValue: saved ?? "",
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      typed.current = true;
      setEmpty(e.target.value === "");
    },
    onBlur: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      /* A box nobody typed in writes nothing, so what it shows can never
         replace what is saved. */
      if (!typed.current) return;
      typed.current = false;
      if (halfDate()) {
        e.target.value = saved ?? "";
        setEmpty(!saved);
        return;
      }
      const edit = optionEdit(e.target.value, saved);
      if (edit !== undefined) void patchOption(option.id, { [field]: edit });
    },
  };

  if (type === "text") {
    return (
      <textarea
        {...shared}
        className={styles.optionNote}
        rows={1}
        placeholder="Note"
        maxLength={NOTE_MAX}
        /* Enter ends the edit, as in every other box; Shift+Enter makes a line. */
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  return (
    <input
      {...shared}
      type="date"
      className={`${styles.optionDate} ${empty ? styles.optionDateEmpty : ""}`}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/** The selects a property may be shown by: any single select but itself. */
function whenCandidates(property: PropertyDTO, all: PropertyDTO[]): PropertyDTO[] {
  return all.filter((p) => p.id !== property.id && isSelect(p.type));
}

/**
 * "Shown when Type is Bug or Story": a select, then its options. Each tick
 * saves at once, as the dated switch does. Untick the last one and the rule
 * goes, because an empty set would read as always shown anyway.
 */
function WhenRow({
  property,
  canEdit,
  onClose,
}: {
  property: PropertyDTO;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { data } = useBoard();
  const { rule, asking, toggle, write, confirm, cancel } = useWhenWrite(property);
  const candidates = whenCandidates(property, data.properties);
  /* A select picked and not yet answered writes nothing, as a new filter rule
     does: the rule is the select and at least one option. */
  const [picked, setPicked] = useState<string | null>(null);
  const shownBy = candidates.find((p) => p.id === (picked ?? rule?.propertyId)) ?? null;
  const ticked = rule && shownBy && rule.propertyId === shownBy.id ? rule.optionIds : [];

  function clear() {
    setPicked(null);
    onClose();
    if (rule) void write(null);
  }

  return (
    <div className={styles.when}>
      <span className={styles.whenSaid} data-testid="when-said">
        {rule ? whenSaid(rule, data.properties) : "Shown when"}
      </span>
      {canEdit && (
        <>
          <Select
            aria-label={`Shown when of ${property.name}`}
            className={styles.whenPick}
            value={shownBy?.id ?? ""}
            onChange={(picked) => setPicked(picked || null)}
            options={[
              { value: "", label: "Pick a select" },
              ...candidates.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          {shownBy &&
            [...shownBy.options.map((o) => o.id), NO_VALUE_KEY].map((id) => (
              <Checkbox
                key={id}
                label={keyName(id, shownBy, [])}
                checked={ticked.includes(id)}
                onChange={(e) => void toggle(shownBy, id, e.target.checked)}
              />
            ))}
          <IconButton
            label={rule ? `Always show ${property.name}` : "Cancel"}
            title={rule ? "Clear the rule: always show this property" : "Cancel"}
            onClick={clear}
          >
            ✕
          </IconButton>
        </>
      )}
      {asking && (
        <div className={styles.whenAsk} data-testid="when-confirm">
          <ConfirmRow
            question={asking.question}
            confirmLabel="Yes, hide"
            onConfirm={confirm}
            onCancel={cancel}
          />
        </div>
      )}
    </div>
  );
}

/**
 * An iteration's cadence: how long a sprint is. The box saves on blur, and on
 * leave for a tab closed while it still has the focus.
 */
function CadenceRow({ property, canEdit }: { property: PropertyDTO; canEdit: boolean }) {
  const cadence = readCadence(property.config);
  return (
    <div className={styles.cadence}>
      <CadenceBox
        property={property}
        field="length"
        saved={cadence.length}
        max={LENGTH_MAX}
        label="Sprint length in days"
        unit="days a sprint"
        canEdit={canEdit}
      />
      <Note>
        A sprint ends when somebody presses Close. If no open sprint follows, Close makes the next
        one, named and dated after the last.
      </Note>
    </div>
  );
}

function CadenceBox({
  property,
  field,
  saved,
  max,
  label,
  unit,
  canEdit,
}: {
  property: PropertyDTO;
  field: keyof Cadence;
  saved: number;
  max: number;
  label: string;
  unit: string;
  canEdit: boolean;
}) {
  const { patchProperty } = useBoard();
  const [draft, setDraft] = useState(String(saved));
  /* Only what this tab typed may be written back, as for the name. */
  const [typed, setTyped] = useState(false);
  const edit = typed ? cadenceEdit(draft, saved, max) : null;
  useSaveOnLeave(() =>
    edit === null
      ? null
      : {
          method: "PATCH",
          url: `/api/properties/${property.id}`,
          body: { cadence: { [field]: edit } },
        },
  );
  return (
    <label className={styles.cadenceBox}>
      <Input
        aria-label={`${label} of ${property.name}`}
        inputMode="numeric"
        className={styles.cadenceInput}
        value={typed ? draft : String(saved)}
        disabled={!canEdit}
        onChange={(e) => {
          setDraft(e.target.value);
          setTyped(true);
        }}
        onBlur={() => {
          setTyped(false);
          if (edit !== null) void patchProperty(property.id, { cadence: { [field]: edit } });
          setDraft(String(edit ?? saved));
        }}
      />
      {unit}
    </label>
  );
}
