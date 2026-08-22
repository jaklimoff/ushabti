"use client";

import { useEffect, useRef, useState } from "react";
import { useBoard } from "@/components/board/store";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, NameInput, Select } from "@/components/ui/Form";
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
  const { data, addProperty } = useBoard();
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("select");
  const [options, setOptions] = useState("");
  const isOwner = data.project.role === "owner";

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
        note="Every field on a task lives here. Nothing is built in — rename, recolour or delete whatever you like."
      />

      <Card>
        {data.properties.map((property, index) => (
          <PropertyRow
            key={property.id}
            property={property}
            isOwner={isOwner}
            upTarget={index >= 2 ? data.properties[index - 2].id : index === 1 ? null : undefined}
            downTarget={data.properties[index + 1]?.id}
          />
        ))}

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

/**
 * `upTarget` is the property this one lands behind when it moves up: two rows
 * higher, or null for the very top. `undefined` means the row cannot move.
 */
function PropertyRow({
  property,
  isOwner,
  upTarget,
  downTarget,
}: {
  property: PropertyDTO;
  isOwner: boolean;
  upTarget: string | null | undefined;
  downTarget: string | undefined;
}) {
  const { data, patchProperty, moveProperty, deleteProperty, addOption } = useBoard();
  const [name, setName] = useState(property.name);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const confirm = useConfirm();
  const showOnCard = property.config.showOnCard !== false;
  const canMoveUp = upTarget !== undefined;
  const canMoveDown = downTarget !== undefined;

  // How much a delete costs, in the numbers the person can check.
  const values = data.tasks.filter((t) => {
    const v = t.values[property.id];
    return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "";
  }).length;
  const cost = [
    property.options.length
      ? `${property.options.length} ${property.options.length === 1 ? "option" : "options"}`
      : null,
    `${values} ${values === 1 ? "value" : "values"}`,
  ]
    .filter(Boolean)
    .join(" and ");

  if (confirm.asking) {
    return (
      <div className={styles.propBox} data-testid="property-box">
        <ConfirmRow
          question={`Delete ${property.name}? ${cost} go with it.`}
          onConfirm={() => confirm.confirm(() => void deleteProperty(property.id))}
          onCancel={confirm.cancel}
        />
      </div>
    );
  }

  return (
    <div className={styles.propBox} data-testid="property-box">
      <div className={styles.propHead}>
        <div className={styles.propName}>
          <NameInput
            aria-label={`Name of the ${property.name} property`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (trimmed && trimmed !== property.name)
                void patchProperty(property.id, { name: trimmed });
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
            onClick={() => void patchProperty(property.id, { showOnCard: !showOnCard })}
          >
            On card {showOnCard ? "◉" : "○"}
          </button>
          <IconButton
            label={`Move ${property.name} up`}
            title="Move up"
            disabled={!canMoveUp}
            onClick={() => canMoveUp && void moveProperty(property.id, upTarget ?? null)}
          >
            ↑
          </IconButton>
          <IconButton
            label={`Move ${property.name} down`}
            title="Move down"
            disabled={!canMoveDown}
            onClick={() => downTarget && void moveProperty(property.id, downTarget)}
          >
            ↓
          </IconButton>
          {isOwner && (
            <IconButton
              danger
              label={`Delete the property ${property.name}`}
              title="Delete this property and every value in it"
              onClick={confirm.ask}
            >
              ✕
            </IconButton>
          )}
        </div>
      </div>

      {(property.type === "select" || property.type === "multi_select") && (
        <div className={styles.options}>
          {property.options.map((option) => (
            <OptionChip key={option.id} option={option} isOwner={isOwner} />
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
  isOwner,
}: {
  option: PropertyDTO["options"][number];
  isOwner: boolean;
}) {
  const { patchOption, deleteOption } = useBoard();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLSpanElement>(() => setOpen(false), open);

  return (
    <span className={styles.option} ref={ref}>
      <button
        type="button"
        className={styles.swatchBtn}
        style={{ background: option.color }}
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
      {isOwner && (
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

  useEffect(() => {
    if (box.current && document.activeElement !== box.current) box.current.value = option.name;
  }, [option.name]);

  return (
    <input
      ref={box}
      className={styles.optionInput}
      aria-label={`Name of the option ${option.name}`}
      defaultValue={option.name}
      onBlur={(e) => {
        const value = e.target.value.trim();
        if (value && value !== option.name) void patchOption(option.id, { name: value });
        else e.target.value = option.name;
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
