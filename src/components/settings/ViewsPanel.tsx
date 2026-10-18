"use client";

import { useRef, useState } from "react";
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
import { Button, ButtonPageLink, IconButton } from "@/components/ui/Button";
import { Label, NameInput, Select } from "@/components/ui/Form";
import { ViewKindMark } from "@/components/ui/Marks";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { Card, Row, Tag } from "@/components/ui/Layout";
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
import { canManage } from "@/lib/roles";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

export function ViewsPanel() {
  const { data, moveView } = useBoard();
  const groupable = data.properties.filter((p) => GROUPABLE_TYPES.includes(p.type));

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

      <Card className={styles.viewsCard}>
        {/* The words over the columns, said once. Each row repeated them, and
            they wrapped mid-word. A phone has no columns, so its rows keep
            their own words and this head goes. */}
        <div className={styles.viewsHead} aria-hidden>
          <span className={styles.viewsHeadName}>View</span>
          <span className={styles.viewsHeadKind}>Shows as</span>
          <span className={styles.viewsHeadGroup}>Grouped by</span>
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
              <ViewRow key={view.id} view={view} groupable={groupable} />
            ))}
          </SortableContext>
        </DndContext>
      </Card>
    </>
  );
}

function ViewRow({ view, groupable }: { view: ViewDTO; groupable: PropertyDTO[] }) {
  const { data, updateView, deleteView, setMainView, resetCardView } = useBoard();
  const confirm = useConfirm();
  /* Throwing a copy away loses what somebody arranged, so it asks in place,
     as deleting does. */
  const unCopy = useConfirm();
  const box = useRef<HTMLInputElement>(null);
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

  if (unCopy.asking) {
    return (
      <div className={styles.viewWhole}>
        <ConfirmRow
          question={`Use the default card view for ${view.name}? Its own copy goes, and it draws the project's again.`}
          confirmLabel="Yes, use the default"
          onConfirm={() => unCopy.confirm(() => void resetCardView(view.id))}
          onCancel={unCopy.cancel}
        />
      </div>
    );
  }

  return (
    <Row
      ref={setNodeRef}
      className={[styles.viewHead, isDragging ? styles.rowLifted : ""].filter(Boolean).join(" ")}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined,
      }}
    >
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
          <Tag accent title="The view a board opens on. It is the one view that cannot be deleted.">
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
              disabled: GROUPED_KINDS.includes(option) && !propertiesFor(option, groupable).length,
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
        {/* A list's columns are its card view, so a list is arranged here
            too. The view keeps a copy only once somebody changes it. A
            roadmap draws no card, so it has nothing to arrange. */}
        {view.kind !== "roadmap" && (
          <span className={`${styles.viewPair} ${styles.viewCard}`}>
            <ButtonPageLink
              variant="text"
              href={`/p/${data.project.id}/settings/views/${view.id}/card`}
              aria-label={`Card view of ${view.name}`}
              title={
                view.cardView
                  ? "This view keeps a card view of its own."
                  : "This view draws the project's card view."
              }
            >
              {view.cardView ? "Own card view…" : "Card view…"}
            </ButtonPageLink>
            {view.cardView && (
              <Button
                variant="text"
                aria-label={`Use the default card view for ${view.name}`}
                title="Throw this view's copy away and draw the project's card view again."
                onClick={unCopy.ask}
              >
                Use the default
              </Button>
            )}
          </span>
        )}
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
    </Row>
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
