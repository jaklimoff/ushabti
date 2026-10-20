"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBoard } from "@/components/board/store";
import { canManage } from "@/lib/roles";
import { canStartAs, readWhens, typeSheet, whenSaid } from "@/lib/when";
import { isSelect, type PropertyDTO } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { Card, EmptyState, Foot, Note, Row, Section } from "@/components/ui/Layout";
import { ConfirmRow } from "@/components/ui/ConfirmRow";
import { PageHead } from "./SettingsShell";
import { useWhenWrite } from "./useWhenWrite";
import { StartsAs } from "./StartsAs";
import styles from "./settings.module.css";

const WHAT_A_TYPE_IS =
  "A type is an option of one select, such as Bug or Story, and a property can show only on the types it applies to.";

/**
 * The Types page: the Properties page read type first.
 *
 * It stores nothing but which select is the Type. Every list here is a
 * reading of each property's `when`, and every change writes that rule
 * through the same hook as the Properties page.
 */
export function TypesPanel() {
  const { data, send, refresh, notify, addOption } = useBoard();
  const router = useRouter();
  const canEdit = canManage(data.project.role);
  const selects = data.properties.filter((p) => isSelect(p.type));
  const type = selects.find((p) => p.id === data.project.typeBy) ?? null;
  const [openId, setOpenId] = useState<string | null>(null);
  const open = type?.options.find((o) => o.id === openId) ?? type?.options[0] ?? null;
  const [name, setName] = useState("");
  /* A press waits for its answer, so a second press cannot add a second type. */
  const [adding, setAdding] = useState(false);

  async function pick(typeBy: string | null) {
    try {
      await send.patch(`/api/projects/${data.project.id}`, { typeBy });
      await refresh();
      router.refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save.");
    }
  }

  async function add() {
    const trimmed = name.trim();
    if (!type || !trimmed || adding) return;
    setAdding(true);
    const id = await addOption(type.id, trimmed);
    setAdding(false);
    if (!id) return;
    setName("");
    setOpenId(id);
  }

  return (
    <>
      <PageHead title="Types" note={WHAT_A_TYPE_IS} />

      <Card>
        <Row>
          <Field label="Types come from" inline>
            <Select
              aria-label="Types come from"
              value={type?.id ?? ""}
              disabled={!canEdit || selects.length === 0}
              onChange={(picked) => void pick(picked || null)}
              options={[
                { value: "", label: "No select" },
                ...selects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <Note>
              {selects.length === 0 ? (
                <>
                  This project has no select property yet. Add one on the <PropertiesLink />.
                </>
              ) : canEdit ? (
                "Each option of this select is a type."
              ) : (
                "Only the owner or an admin can pick the select types come from."
              )}
            </Note>
          </Field>
        </Row>
        {/* Off, the page used to be one box and nothing under it. It says what
            turning types on gives, with this project's own words where it can. */}
        {!type && <TypesOff selects={selects} />}
      </Card>

      {type && (
        <Section
          title="Types"
          note={`The options of ${type.name}. Press one to see what it shows.`}
        >
          <Card>
            <div className={styles.typeList} role="group" aria-label="Types">
              {type.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`${styles.typeItem} ${o.id === open?.id ? styles.typeItemOn : ""}`}
                  aria-pressed={o.id === open?.id}
                  onClick={() => setOpenId(o.id)}
                >
                  <span className={styles.typeDot} style={{ background: o.color }} />
                  {o.name}
                </button>
              ))}
              {type.options.length === 0 && <Note>{type.name} has no options yet.</Note>}
            </div>
            {/* A member adds a type as they add a property; only deleting one is an admin's. */}
            <Foot>
              <Input
                width="medium"
                aria-label="New type name"
                value={name}
                placeholder="New type"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void add();
                }}
              />
              <Button disabled={adding} onClick={() => void add()}>
                Add type
              </Button>
            </Foot>
          </Card>
        </Section>
      )}

      {/* Keyed by the type, so a question one type asked never answers on another. */}
      {type && open && <TypeSheet key={open.id} type={type} optionId={open.id} canEdit={canEdit} />}
    </>
  );
}

/** What one type shows, in four groups. */
function TypeSheet({
  type,
  optionId,
  canEdit,
}: {
  type: PropertyDTO;
  optionId: string;
  canEdit: boolean;
}) {
  const { data } = useBoard();
  const name = type.options.find((o) => o.id === optionId)?.name ?? "";
  const sheet = typeSheet(readWhens(data.properties), type.id, optionId);
  const row = (property: PropertyDTO, also: string[], kind: Kind) => (
    <TypeRow
      key={property.id}
      property={property}
      type={type}
      optionId={optionId}
      typeName={name}
      also={also}
      kind={kind}
      canEdit={canEdit}
    />
  );

  return (
    <div data-testid="type-sheet">
      <Section title={`On ${name}`} note="The properties a task of this type shows.">
        <Card>
          <h3 className={styles.typeGroup}>Every type</h3>
          {sheet.every.map((p) => row(p, [], "every"))}
          {sheet.every.length === 0 && <EmptyRow />}
          <h3 className={styles.typeGroup}>This type</h3>
          {sheet.here.map((r) => row(r.property, r.also, "here"))}
          {sheet.here.length === 0 && <EmptyRow />}
        </Card>
      </Section>
      {sheet.elsewhere.length > 0 && (
        <Section title="On other types" note={`Not on ${name}.`}>
          <Card>{sheet.elsewhere.map((r) => row(r.property, r.also, "elsewhere"))}</Card>
        </Section>
      )}
      {sheet.ruledBy.length > 0 && (
        <Section
          title="Shown by another select"
          note={
            <>
              Change these on the <PropertiesLink />.
            </>
          }
        >
          <Card>
            {sheet.ruledBy.map(({ property, said }) => (
              <Row key={property.id} data-testid="type-row">
                <span className={styles.typeName}>{property.name}</span>
                <Note>{said}</Note>
              </Row>
            ))}
          </Card>
        </Section>
      )}
    </div>
  );
}

/**
 * What types give, said while they are off: a property that shows only on
 * some types, and a new task that starts with values of its own type.
 */
function TypesOff({ selects }: { selects: PropertyDTO[] }) {
  return (
    <div className={styles.typesOff} data-testid="types-off">
      <EmptyState title="Types are off">
        Pick a select, such as Kind, and each of its options becomes a type.
        {selects.length > 0 && (
          <> This project could take its types from {orList(selects.map((p) => p.name))}.</>
        )}
      </EmptyState>
      <ul className={styles.typesGain}>
        <li>
          <span className={styles.typesGainHead}>Properties per type</span>
          <span className={styles.typesGainBody}>
            Severity can show only on a Bug, and stay off a Story.
          </span>
        </li>
        <li>
          <span className={styles.typesGainHead}>A start per type</span>
          <span className={styles.typesGainBody}>
            A new Bug can start as High priority, and a new Story as Medium.
          </span>
        </li>
      </ul>
    </div>
  );
}

/** "A", "A or B", "A, B or C". */
function orList(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

type Kind = "every" | "here" | "elsewhere";

function EmptyRow() {
  return (
    <Row>
      <Note>None.</Note>
    </Row>
  );
}

function PropertiesLink() {
  const { data } = useBoard();
  return <Link href={`/p/${data.project.id}/settings/properties`}>Properties page</Link>;
}

/**
 * One property under one type, and the one change that fits where it sits.
 * The last type of a property is not taken away here: what it shows then is
 * a question for the Properties page, which can say "always".
 */
function TypeRow({
  property,
  type,
  optionId,
  typeName,
  also,
  kind,
  canEdit,
}: {
  property: PropertyDTO;
  type: PropertyDTO;
  optionId: string;
  typeName: string;
  also: string[];
  kind: Kind;
  canEdit: boolean;
}) {
  const { data } = useBoard();
  const { rule, asking, toggle, write, confirm, cancel } = useWhenWrite(property);
  const said = rule ? whenSaid(rule, data.properties) : null;

  return (
    <Row className={styles.typeRow} data-testid="type-row">
      <span className={styles.typeName}>{property.name}</span>
      {kind === "here" && also.length > 0 && <Note>also on {also.join(", ")}</Note>}
      {kind === "elsewhere" && <Note>{also.length ? `on ${also.join(", ")}` : said}</Note>}
      <span className={styles.typeAct} data-testid="type-act">
        {canEdit && kind === "every" && (
          <Button
            variant="text"
            onClick={() => void write({ propertyId: type.id, optionIds: [optionId] })}
          >
            Only on {typeName}
          </Button>
        )}
        {canEdit && kind === "elsewhere" && (
          <Button variant="text" onClick={() => void toggle(type, optionId, true)}>
            Add to {typeName}
          </Button>
        )}
        {canEdit && kind === "here" && also.length > 0 && (
          <Button variant="text" onClick={() => void toggle(type, optionId, false)}>
            Take off {typeName}
          </Button>
        )}
        {/* A member reads why there is nothing to press, too. */}
        {kind === "here" && also.length === 0 && (
          <Note>
            Only on {typeName}.
            {canEdit && (
              <>
                {" "}
                Change it on the <PropertiesLink />.
              </>
            )}
          </Note>
        )}
      </span>
      {(kind === "every" || kind === "here") && canStartAs(property.type) && (
        <StartsAs property={property} optionId={optionId} canEdit={canEdit} />
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
    </Row>
  );
}
