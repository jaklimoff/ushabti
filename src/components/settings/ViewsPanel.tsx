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
import { IconButton } from "@/components/ui/Button";
import { NameInput, Select } from "@/components/ui/Form";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { Card, Row, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import {
  GROUPABLE_TYPES,
  VIEW_KINDS,
  VIEW_KIND_LABEL,
  type PropertyDTO,
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
        note="A view is one way of looking at the same tasks. A board puts them in columns; a list puts them in rows. Drag a view by its grip to change where it sits, here and in the strip above the board. A new view is made with the + at the end of that strip."
      />

      <Card>
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
  const { data, updateView, deleteView, setMainView } = useBoard();
  const confirm = useConfirm();
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
    if (next === "board" && !view.groupById) {
      const first = groupable[0]?.id;
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
      <ConfirmRow
        question={`Delete the view ${view.name}? The tasks stay; only this way of looking at them goes.`}
        onConfirm={() => confirm.confirm(() => void deleteView(view.id))}
        onCancel={confirm.cancel}
      />
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
      <NameInput
        ref={box}
        className={styles.viewName}
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
      {/* The main view is named, never unnamed: a project always has one, so
          the way off the word is to give it to another view. The word and the
          two boxes are wrapped because a phone puts them on two lines, and a
          line is given a whole part of the row rather than one box of it. */}
      {view.isDefault ? (
        <span className={styles.viewMain}>
          <Tag accent title="The view a board opens on. It is the one view that cannot be deleted.">
            main
          </Tag>
        </span>
      ) : (
        canEdit && (
          <span className={styles.viewMain}>
            <button
              type="button"
              className={styles.makeMain}
              aria-label={`Make ${view.name} the main view`}
              title="The board opens on the main view, and it cannot be deleted."
              onClick={() => void setMainView(view.id)}
            >
              Make main
            </button>
          </span>
        )
      )}
      {/* A label and its box are one pair, so that a phone wraps between the
          two questions and never between a question and its answer. */}
      <div className={styles.viewShape}>
        <span className={styles.viewPair}>
          <span className="label">Shows as</span>
          <Select
            aria-label={`How the view ${view.name} shows`}
            value={view.kind}
            onChange={(e) => setKind(e.target.value as ViewKind)}
          >
            {VIEW_KINDS.map((option) => (
              <option
                key={option}
                value={option}
                disabled={option === "board" && !view.groupById && !groupable.length}
              >
                {VIEW_KIND_LABEL[option]}
              </option>
            ))}
          </Select>
        </span>
        {view.kind === "board" && (
          <span className={styles.viewPair}>
            <span className="label">Columns by</span>
            <Select
              aria-label={`Grouping property of the view ${view.name}`}
              value={view.groupById ?? ""}
              onChange={(e) => void updateView(view.id, { groupById: e.target.value })}
            >
              {groupable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </span>
        )}
      </div>
      {!view.isDefault && canEdit && (
        <IconButton
          className={styles.viewTools}
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
