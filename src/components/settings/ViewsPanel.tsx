"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { TaskCard } from "@/components/board/TaskCard";
import { ReadRuleChips } from "@/components/board/Filters";
import { Button, IconButton, Pill } from "@/components/ui/Button";
import { Label, NameInput, Select } from "@/components/ui/Form";
import { Chevron, ViewKindMark } from "@/components/ui/Marks";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { Card, Note, Row, Section, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import {
  GROUPABLE_TYPES,
  GROUPED_KINDS,
  hasOptions,
  isSelect,
  type PropertyDTO,
  VIEW_KIND_LABEL,
  VIEW_KINDS,
  type ViewDTO,
  type ViewKind,
} from "@/lib/types";
import { filterProperties } from "@/lib/filters";
import { canManage } from "@/lib/roles";
import { previewTasks } from "@/lib/card-view";
import { CardEditor } from "./CardViewPanel";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

export function ViewsPanel() {
  const { data, moveView } = useBoard();
  const groupable = data.properties.filter((p) => GROUPABLE_TYPES.includes(p.type));
  /* One row open at a time, so the page stays a list of views to scan. An
     old link to a view's card page lands here with that row open. */
  const asked = useSearchParams().get("open");
  const [open, setOpen] = useState<string | null>(asked);

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

      <DefaultCard />

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

/**
 * The project's card, said before the views that draw it, so a change to it
 * names who it reaches. A roadmap draws no card and is in neither list.
 */
function DefaultCard() {
  const { data, cardItemsOf } = useBoard();
  const [editing, setEditing] = useState(false);
  const items = useMemo(() => cardItemsOf(null), [cardItemsOf]);
  const first = useMemo(
    () => previewTasks(data.tasks, data.properties, data.members, data.project.key, 1)[0],
    [data.members, data.project.key, data.properties, data.tasks],
  );
  const drawing = data.views.filter((v) => v.kind !== "roadmap");
  const follow = drawing.filter((v) => v.cardView == null).map((v) => v.name);
  const own = drawing.filter((v) => v.cardView != null).map((v) => v.name);

  return (
    <Section
      title="Default card"
      action={
        <Button variant="ghost" aria-expanded={editing} onClick={() => setEditing((on) => !on)}>
          {/* Not "Done": nothing here waits for a press to be saved. */}
          {editing ? "Close editor" : "Edit the default card"}
        </Button>
      }
    >
      <div className={styles.defaultCard} data-testid="default-card">
        <p className={styles.defaultCardSaid}>
          <Note>What a card carries, unless a view has its own.</Note>{" "}
          <span data-testid="default-card-followers">
            <Note>{followersSaid(follow, own)}</Note>
          </span>
        </p>
        {editing ? (
          <CardEditor />
        ) : (
          first && (
            <div className={styles.defaultCardPreview}>
              <TaskCard task={first} items={items} />
            </div>
          )
        )}
      </div>
    </Section>
  );
}

function namesSaid(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function followersSaid(follow: string[], own: string[]): string {
  const follows = follow.length
    ? `${namesSaid(follow)} ${follow.length === 1 ? "follows" : "follow"} it.`
    : "No view follows it.";
  if (!own.length) return follows;
  return `${follows} ${namesSaid(own)} ${own.length === 1 ? "has a card" : "have cards"} of ${own.length === 1 ? "its" : "their"} own.`;
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
          {/* One line, so every row is one height and the column starts at one
              x: a roadmap says it has no card rather than leaving a hole. */}
          <span className={`${styles.viewPair} ${styles.viewCard}`} data-testid="view-summary">
            <span
              className={!draws ? styles.viewCardNone : own ? styles.viewCardOwn : undefined}
              title={
                !draws
                  ? "A roadmap draws bars, not cards."
                  : own
                    ? "This view keeps a card of its own."
                    : "This view draws the project's default card."
              }
            >
              {!draws ? "No card" : own ? "Own card" : "Default card"}
            </span>
            <span className={styles.viewCardDot} aria-hidden>
              ·
            </span>
            <span
              className={styles.viewFilters}
              title={rules.length ? "Everybody who opens this view sees these filters." : undefined}
            >
              {rules.length === 0
                ? "no filters"
                : `${rules.length} ${rules.length === 1 ? "filter" : "filters"}`}
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
          {view.kind === "board" && <StartsFolded view={view} />}
          {draws && (
            <section className={styles.viewPart} aria-label={`Card of ${view.name}`}>
              {/* A list draws the same card view as columns, so that is what it
                  is called here. */}
              <h3 className={styles.viewPartHead}>
                {view.kind === "list" ? "Its columns" : "Its card"}
              </h3>
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
              {/* A board view shows one card at the board's size above the
                  drawing, as the board's own Card panel does. */}
              <CardEditor
                viewId={view.id}
                bare
                sample={view.kind === "board"}
                startOn={view.kind === "list" ? "list" : "card"}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * The columns a board starts with folded, for whoever never folded one there.
 * Each press writes the whole list, worked out from the saved one, so a second
 * press waits for the first answer rather than writing over it. A person's
 * own fold on the board stays theirs, which is why there is no button for
 * this on the column head.
 */
function StartsFolded({ view }: { view: ViewDTO }) {
  const { data, updateView } = useBoard();
  const [sending, setSending] = useState(false);
  const group = data.properties.find((p) => p.id === view.groupById);

  async function press(optionId: string) {
    if (sending || !group) return;
    const saved = view.startFolded;
    const next = group.options
      .map((o) => o.id)
      .filter((id) => (id === optionId ? !saved.includes(id) : saved.includes(id)));
    setSending(true);
    try {
      await updateView(view.id, { startFolded: next });
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={styles.viewPart} aria-label={`Starts folded of ${view.name}`}>
      <h3 className={styles.viewPartHead}>Starts folded</h3>
      {group && hasOptions(group.type) ? (
        <>
          <div
            role="group"
            aria-label={`The columns ${view.name} starts with folded`}
            className={styles.viewFolds}
          >
            {group.options.map((o) => (
              <Pill
                key={o.id}
                on={view.startFolded.includes(o.id)}
                color={o.color}
                disabled={sending}
                onClick={() => void press(o.id)}
              >
                {o.name}
              </Pill>
            ))}
          </div>
          <Note>For anybody who never folded a column here. A fold of their own wins.</Note>
        </>
      ) : (
        <Note>Only the columns of a select can start folded.</Note>
      )}
    </section>
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
