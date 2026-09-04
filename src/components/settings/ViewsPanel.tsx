"use client";

import { useState } from "react";
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
import { Button, IconButton } from "@/components/ui/Button";
import { Input, NameInput, Select } from "@/components/ui/Form";
import { Card, Foot, Note, Row, Spacer, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import {
  GROUPABLE_TYPES,
  VIEW_KINDS,
  VIEW_KIND_LABEL,
  type PropertyDTO,
  type ViewDTO,
  type ViewKind,
} from "@/lib/types";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

export function ViewsPanel() {
  const { data, createView, moveView } = useBoard();
  const groupable = data.properties.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ViewKind>("board");
  const [groupById, setGroupById] = useState(groupable[0]?.id ?? "");

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

  async function create() {
    const chosen = groupById || groupable[0]?.id || null;
    if (kind === "board" && !chosen) return;
    const property = data.properties.find((p) => p.id === chosen);
    const taken = new Set(data.views.map((v) => v.name.toLowerCase()));
    let fallback = `By ${property?.name.toLowerCase() ?? "property"}`;
    if (kind === "list") {
      fallback = "List";
      for (let n = 2; taken.has(fallback.toLowerCase()); n += 1) fallback = `List ${n}`;
    }
    const title = name.trim() || fallback;
    setName("");
    await createView(title, kind, kind === "board" ? chosen : null);
  }

  return (
    <>
      <PageHead
        title="Views"
        note="A view is one way of looking at the same tasks. A board puts them in columns; a list puts them in rows. Drag a view by its grip to change where it sits, here and in the strip above the board."
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

        <Foot>
          <Input
            style={{ flex: 1, minWidth: 140 }}
            aria-label="Name of the new view"
            value={name}
            placeholder="View name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <span className="label">Shows as</span>
          <Select
            aria-label="How the new view shows"
            value={kind}
            onChange={(e) => setKind(e.target.value as ViewKind)}
          >
            {VIEW_KINDS.map((option) => (
              <option
                key={option}
                value={option}
                disabled={option === "board" && !groupable.length}
              >
                {VIEW_KIND_LABEL[option]}
              </option>
            ))}
          </Select>
          {/* A list groups nothing, so the question is not asked. Hidden, not
              disabled: a disabled control is a question with no answer. */}
          {kind === "board" && (
            <>
              <span className="label">Columns by</span>
              <Select
                aria-label="Grouping property of the new view"
                value={groupById}
                onChange={(e) => setGroupById(e.target.value)}
              >
                {groupable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </>
          )}
          <Button onClick={() => void create()} disabled={kind === "board" && !groupable.length}>
            Add view
          </Button>
          {groupable.length === 0 && (
            <span style={{ width: "100%" }}>
              <Note>A board needs a select, person or checkbox property. Add one first.</Note>
            </span>
          )}
        </Foot>
      </Card>
    </>
  );
}

function ViewRow({ view, groupable }: { view: ViewDTO; groupable: PropertyDTO[] }) {
  const { data, updateView, deleteView, setMainView } = useBoard();
  const confirm = useConfirm();
  const isOwner = data.project.role === "owner";
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
      className={isDragging ? styles.rowLifted : undefined}
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
        aria-label={`Name of the view ${view.name}`}
        defaultValue={view.name}
        onBlur={(e) => {
          const value = e.target.value.trim();
          if (value && value !== view.name) void updateView(view.id, { name: value });
          else e.target.value = view.name;
        }}
      />
      {/* The main view is named, never unnamed: a project always has one, so
          the way off the word is to give it to another view. */}
      {view.isDefault ? (
        <Tag accent title="The view a board opens on. It is the one view that cannot be deleted.">
          main
        </Tag>
      ) : (
        isOwner && (
          <button
            type="button"
            className={styles.makeMain}
            aria-label={`Make ${view.name} the main view`}
            title="The board opens on the main view, and it cannot be deleted."
            onClick={() => void setMainView(view.id)}
          >
            Make main
          </button>
        )
      )}
      <Spacer />
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
      {view.kind === "board" && (
        <>
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
        </>
      )}
      {!view.isDefault && isOwner && (
        <IconButton
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
