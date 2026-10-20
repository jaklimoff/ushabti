"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
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
import { editedText } from "@/lib/leave";
import { useBoard } from "@/components/board/store";
import { ReadRuleChips } from "@/components/board/Filters";
import { Button, IconButton } from "@/components/ui/Button";
import { Label, NameInput, Select } from "@/components/ui/Form";
import { Chevron, ViewKindMark } from "@/components/ui/Marks";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { Card, Note, Row, Section, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import {
  GROUPABLE_TYPES,
  GROUPED_KINDS,
  isSelect,
  type PropertyDTO,
  VIEW_KIND_LABEL,
  VIEW_KINDS,
  type ViewDTO,
  type ViewKind,
} from "@/lib/types";
import { filterProperties } from "@/lib/filters";
import { canManage } from "@/lib/roles";
import { CardEditor } from "./CardViewPanel";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

export function ViewsPanel() {
  const { data, moveView } = useBoard();
  const groupable = data.properties.filter((p) => GROUPABLE_TYPES.includes(p.type));
  /* One row open at a time, so the page stays a list of views to scan. */
  const [open, setOpen] = useState<string | null>(null);

  /* The grip is the only thing that lifts a row, so the boxes on it still take
     a caret and a click. Space lifts, the arrows move, Space puts it down:
     this page is the way to change the order without a pointer. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void moveView(String(active.id), String(over.id));
  }

  return (
    <>
      <PageHead
        title="Views"
        note="A view is one way of looking at the same tasks. A board puts them in columns; a list puts them in rows."
      />

      <Section title="Views" note={String(data.views.length)}>
        <Card className={styles.viewsCard}>
          {/* The words over the columns, said once. Each row repeated them, and
            they wrapped mid-word. A phone has no columns, so its rows keep
            their own words and this head goes. */}
          <div className={styles.viewsHead} aria-hidden>
            <span className={styles.viewsHeadName}>View</span>
            <span className={styles.viewsHeadKind}>Shows as</span>
            <span className={styles.viewsHeadGroup}>Grouped by</span>
            <span className={styles.viewsHeadCard}>Card and filters</span>
          </div>
          {/* One column of rows of the same height, so dnd-kit's own answer is
            the right one. Nothing here is as tall as the board. */}
          <DndContext
            id="ushabti-view-rows"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={data.views.map((v) => v.id)}
              strategy={verticalListSortingStrategy}
            >
              {data.views.map((view) => (
                <ViewRow
                  key={view.id}
                  view={view}
                  groupable={groupable}
                  open={open === view.id}
                  onToggle={() => setOpen((current) => (current === view.id ? null : view.id))}
                />
              ))}
            </SortableContext>
          </DndContext>
        </Card>
      </Section>
    </>
  );
}

function ViewRow({
  view,
  groupable,
  open,
  onToggle,
}: {
  view: ViewDTO;
  groupable: PropertyDTO[];
  open: boolean;
  onToggle: () => void;
}) {
  const { data, updateView, deleteView, setMainView, resetCardView } = useBoard();
  const confirm = useConfirm();
  const unCopy = useConfirm();
  const box = useRef<HTMLInputElement>(null);
  const part = useId();
  /* The box holds a name that another tab can change under it, so only what
     this tab typed may be written back. */
  const [typed, setTyped] = useState(false);
  const canEdit = canManage(data.project.role);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: view.id,
    transition: { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });

  /*
   * Changing the kind destroys nothing and asks nothing. A board keeps the
   * property it grouped by, unread, so turning it back restores the same
   * columns; and a view that never had one is given the first that will do,
   * in the same breath and one click from being changed. The alternative is a
   * board with no columns, which is a screen that says nothing.
   */
  function setKind(next: ViewKind) {
    /* A roadmap reads a select alone, so a board grouped by a person is
       given the first select instead. */
    const fits = propertiesFor(next, groupable);
    if (GROUPED_KINDS.includes(next) && !fits.some((p) => p.id === view.groupById)) {
      const first = fits[0]?.id;
      if (!first) return;
      void updateView(view.id, { kind: next, groupById: first });
      return;
    }
    void updateView(view.id, { kind: next });
  }

  /* The name saves on blur, and a closed tab sends no blur. The box holds its
     own words, so the leave reads the box. */
  useSaveOnLeave(() => {
    const edit = typed ? editedText(box.current?.value ?? "", view.name) : null;
    return edit ? { method: "PATCH", url: `/api/views/${view.id}`, body: { name: edit } } : null;
  });

  if (confirm.asking) {
    return (
      <div className={styles.viewWhole}>
        <ConfirmRow
          question={`Delete the view ${view.name}? The tasks stay; only this way of looking at them goes.`}
          onConfirm={() => confirm.confirm(() => void deleteView(view.id))}
          onCancel={confirm.cancel}
        />
      </div>
    );
  }

  /* The row opens on a click anywhere but its controls. A pick in the kind
     menu bubbles here through React, from outside the row, so that is a
     control too. */
  function onRowClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target)) return;
    if (target.closest("button, input, a, label, [role='listbox'], [role='option']")) return;
    onToggle();
  }

  const draws = view.kind !== "roadmap";
  const own = view.cardView != null;
  const askable = filterProperties(data.properties);
  const rules = view.filters.rules.filter((r) => askable.some((p) => p.id === r.propertyId));

  return (
    <div
      ref={setNodeRef}
      className={[styles.viewItem, isDragging ? styles.rowLifted : ""].filter(Boolean).join(" ")}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined,
      }}
    >
      <Row className={styles.viewHead} onClick={onRowClick}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={styles.grip}
          aria-label={`Reorder the view ${view.name}`}
          title="Drag to change where it sits, here and in the strip above the board"
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
        <span className={styles.viewName}>
          <ViewKindGlyph kind={view.kind} />
          <NameInput
            ref={box}
            aria-label={`Name of the view ${view.name}`}
            defaultValue={view.name}
            onChange={() => setTyped(true)}
            onBlur={(e) => {
              setTyped(false);
              const edit = editedText(e.target.value, view.name);
              if (edit) void updateView(view.id, { name: edit });
              else e.target.value = view.name;
            }}
          />
        </span>
        {/* The main view is named, never unnamed: a project always has one, so
          the way off the word is to give it to another view. The word and the
          two boxes are wrapped because a phone puts them on two lines, and a
          line is given a whole part of the row rather than one box of it. */}
        <span className={styles.viewMain}>
          {view.isDefault ? (
            <Tag
              accent
              title="The view a board opens on. It is the one view that cannot be deleted."
            >
              main
            </Tag>
          ) : (
            canEdit && (
              <Button
                variant="text"
                className={styles.viewReveal}
                aria-label={`Make ${view.name} the main view`}
                title="The board opens on the main view, and it cannot be deleted."
                onClick={() => void setMainView(view.id)}
              >
                Make main
              </Button>
            )
          )}
        </span>
        {/* A label and its box are one pair, so that a phone wraps between the
          two questions and never between a question and its answer. */}
        <div className={styles.viewShape}>
          <span className={`${styles.viewPair} ${styles.viewKind}`}>
            <Label className={styles.viewLabel}>Shows as</Label>
            <Select
              aria-label={`How the view ${view.name} shows`}
              value={view.kind}
              onChange={(picked) => setKind(picked as ViewKind)}
              options={VIEW_KINDS.map((option) => ({
                value: option,
                label: VIEW_KIND_LABEL[option],
                disabled:
                  GROUPED_KINDS.includes(option) && !propertiesFor(option, groupable).length,
              }))}
            />
          </span>
          {GROUPED_KINDS.includes(view.kind) ? (
            <span className={`${styles.viewPair} ${styles.viewGroup}`}>
              <Label className={styles.viewLabel}>
                {view.kind === "roadmap" ? "Rows from" : "Columns by"}
              </Label>
              <Select
                aria-label={`Grouping property of the view ${view.name}`}
                value={view.groupById ?? ""}
                onChange={(picked) => void updateView(view.id, { groupById: picked })}
                options={propertiesFor(view.kind, groupable).map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
              />
            </span>
          ) : (
            /* A list groups by nothing on purpose, and says so in the column. */
            <span
              className={`${styles.viewGroup} ${styles.viewNone}`}
              title="A list puts every task in one column of rows."
            >
              Not grouped
            </span>
          )}
          {/* What the row hides when it is shut: whose card it draws and what
            it hides from everybody. A roadmap draws no card. */}
          <span className={`${styles.viewPair} ${styles.viewCard}`} data-testid="view-summary">
            {draws && (
              <Tag
                title={
                  own
                    ? "This view keeps a card of its own."
                    : "This view draws the project's default card."
                }
              >
                {own ? "own card" : "default card"}
              </Tag>
            )}
            <span className={styles.viewFilters}>
              {rules.length === 0
                ? "no filters"
                : `${rules.length} ${rules.length === 1 ? "filter" : "filters"} for everyone`}
            </span>
          </span>
        </div>
        {!view.isDefault && canEdit && (
          <IconButton
            className={`${styles.viewTools} ${styles.viewReveal}`}
            danger
            label={`Delete the view ${view.name}`}
            title="Delete view"
            onClick={confirm.ask}
          >
            ✕
          </IconButton>
        )}
        <IconButton
          className={styles.viewOpener}
          label={open ? `Close the view ${view.name}` : `Open the view ${view.name}`}
          title={open ? "Close" : "Its filters and its card"}
          aria-expanded={open}
          aria-controls={part}
          onClick={onToggle}
        >
          <Chevron size={10} className={open ? styles.viewChevronOpen : styles.viewChevron} />
        </IconButton>
      </Row>
      {open && (
        <div className={styles.viewOpen} id={part} data-testid="view-open">
          <section className={styles.viewPart} aria-label={`Filters of ${view.name}`}>
            <h3 className={styles.viewPartHead}>Filters</h3>
            {rules.length > 0 ? (
              <ReadRuleChips
                properties={data.properties}
                members={data.members}
                former={data.former}
                rules={rules}
              />
            ) : (
              <Note>No filters. It shows every task.</Note>
            )}
            <Link className={styles.viewBoardLink} href={`/p/${data.project.id}?view=${view.id}`}>
              Change them on the board
            </Link>
          </section>
          {draws && (
            <section className={styles.viewPart} aria-label={`Card of ${view.name}`}>
              <h3 className={styles.viewPartHead}>Its card</h3>
              {/* Throwing a copy away loses what somebody arranged, so it asks
                in place, as deleting does. */}
              {unCopy.asking ? (
                <ConfirmRow
                  question={`Use the default card for ${view.name}? Its own card goes, and it draws the default again.`}
                  confirmLabel="Yes, use the default"
                  onConfirm={() => unCopy.confirm(() => void resetCardView(view.id))}
                  onCancel={unCopy.cancel}
                />
              ) : own ? (
                <div className={styles.viewFork} data-testid="view-fork">
                  <Note>
                    {view.name} has a card of its own. A change to the default does not reach it.
                  </Note>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      aria-label={`Use the default card for ${view.name}`}
                      onClick={unCopy.ask}
                    >
                      Use the default
                    </Button>
                  )}
                </div>
              ) : (
                <div className={styles.viewFork} data-testid="view-fork">
                  <Note>
                    {view.name} follows the default card. Your first change here gives it a card of
                    its own.
                  </Note>
                </div>
              )}
              <CardEditor viewId={view.id} bare />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** Quiet here, because on this page the name is what is read. */
function ViewKindGlyph({ kind }: { kind: ViewKind }) {
  return (
    <span className={styles.viewGlyph} title={VIEW_KIND_LABEL[kind]} aria-hidden>
      <ViewKindMark kind={kind} />
    </span>
  );
}

/* A roadmap draws the dated options of a select, so a select is all it offers. */
function propertiesFor(kind: ViewKind, groupable: PropertyDTO[]): PropertyDTO[] {
  return kind === "roadmap" ? groupable.filter((p) => isSelect(p.type)) : groupable;
}
