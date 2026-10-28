"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GROUPABLE_TYPES,
  GROUPED_KINDS,
  isSelect,
  VIEW_KIND_LABEL,
  VIEW_KINDS,
  type ViewDTO,
  type ViewKind,
} from "@/lib/types";
import { ViewKindMark } from "@/components/ui/Marks";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { useDismiss } from "@/components/ui/useDismiss";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { editedText } from "@/lib/leave";
import { canManage } from "@/lib/roles";
import { useEdgeFade } from "./edges";
import { FilterButton, SortButton } from "./Filters";
import { CardIcon, PlusIcon } from "./icons";
import { copyText } from "@/lib/clipboard";
import { useBoard } from "./store";
import styles from "./board.module.css";
import { Label } from "@/components/ui/Form";

const VIEW_DOTS = ["#3fb0c8", "#6d5bd0", "#2f9e7a", "#d1913a", "#c2557a", "#4b8fbe"];

/* The colour follows the view and not its place in the strip. A pill that
   changed colour the moment it was dragged past its neighbour would read as a
   different view. */
function dotOf(view: ViewDTO): string {
  let sum = 0;
  for (const ch of view.id) sum = (sum + ch.charCodeAt(0)) % 4093;
  return VIEW_DOTS[sum % VIEW_DOTS.length];
}

export function ViewStrip({
  filterOpen,
  setFilterOpen,
  sortOpen,
  setSortOpen,
  cardOpen,
  onCard,
}: {
  filterOpen: boolean;
  setFilterOpen: (v: boolean) => void;
  sortOpen: boolean;
  setSortOpen: (v: boolean) => void;
  cardOpen: boolean;
  /** Opens the Card panel, or closes it when it is open. */
  onCard: () => void;
}) {
  const { data, view, visibleTasks, setViewId, createView, moveView } = useBoard();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ViewKind>("board");
  /* A roadmap draws the dated options of a select, so it offers selects alone. */
  const groupable = data.properties.filter((p) =>
    kind === "roadmap" ? isSelect(p.type) : GROUPABLE_TYPES.includes(p.type),
  );
  const [picked, setGroupById] = useState(groupable[0]?.id ?? "");
  const groupById = groupable.some((p) => p.id === picked) ? picked : (groupable[0]?.id ?? "");
  const ref = useDismiss<HTMLDivElement>(() => setAdding(false), adding);

  /* The menu and the name box belong to the open view. Picking another view
     puts both away, because each is tied to the view it was asked about. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuOpen = view != null && menuFor === view.id;

  const plusRef = useRef<HTMLButtonElement>(null);
  const [popLeft, setPopLeft] = useState(14);

  /* The same row the column strip is: pills that pan, and a fade at each end
     that has more. */
  const { ref: stripRef, fade, measure } = useEdgeFade(data.views.length);

  const taskCount = data.tasks.length;
  const shown = visibleTasks.length;

  // The panel used to open at the far left however far right the + had moved.
  useLayoutEffect(() => {
    if (!adding || !plusRef.current || !ref.current) return;
    const anchor = plusRef.current.getBoundingClientRect();
    const host = ref.current.getBoundingClientRect();
    const width = 262;
    const left = anchor.left - host.left - width / 2 + anchor.width / 2;
    setPopLeft(Math.max(10, Math.min(left, host.width - width - 10)));
  }, [adding, ref]);

  /* Three pills all reading "List" is a mess that costs four lines to stop. */
  function untakenName(word: string): string {
    const taken = new Set(data.views.map((v) => v.name.toLowerCase()));
    if (!taken.has(word.toLowerCase())) return word;
    for (let n = 2; ; n += 1) if (!taken.has(`${word.toLowerCase()} ${n}`)) return `${word} ${n}`;
  }

  async function submit() {
    const chosen = groupById || groupable[0]?.id || null;
    /* A board is its columns and cannot be made without one. A list groups
       nothing, so it can be made on a project that has no such property —
       which used to make the whole + a dead end. */
    const grouped = GROUPED_KINDS.includes(kind);
    if (grouped && !chosen) return;
    const property = data.properties.find((p) => p.id === chosen);
    const fallback =
      kind === "list"
        ? untakenName("List")
        : kind === "roadmap"
          ? untakenName("Roadmap")
          : `By ${property?.name.toLowerCase() ?? "property"}`;
    const title = name.trim() || fallback;
    setName("");
    setAdding(false);
    await createView(title, kind, grouped ? chosen : null);
  }

  /* A pill is a button first: it only becomes a drag once the pointer has
     travelled. dnd-kit swallows the click that follows a real drag, so the two
     never happen at once. */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void moveView(String(active.id), String(over.id));
  }

  return (
    <div className={styles.views} ref={ref}>
      {/* One row of pills, all the same height, so dnd-kit's own answer is
          the right one here. The board overrides both because a column is as
          tall as the whole board; nothing in this strip is. */}
      <DndContext
        id="ushabti-views"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <div className={`${styles.viewStrip} ${fade}`} ref={stripRef} onScroll={measure}>
          <SortableContext
            items={data.views.map((v) => v.id)}
            strategy={horizontalListSortingStrategy}
          >
            {data.views.map((v) => (
              <ViewPill
                key={v.id}
                view={v}
                active={v.id === view?.id}
                onPick={() => setViewId(v.id)}
                moreRef={v.id === view?.id ? moreRef : undefined}
                menuOpen={menuOpen && v.id === view?.id}
                onMore={() => setMenuFor((was) => (was === v.id ? null : v.id))}
                renaming={renamingId === v.id && v.id === view?.id}
                onRenamed={() => setRenamingId(null)}
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>

      <button
        ref={plusRef}
        className={styles.plus}
        aria-label="New view"
        aria-expanded={adding}
        title="New view"
        onClick={() => {
          setAdding((v) => !v);
          setKind("board");
          setGroupById(groupable[0]?.id ?? "");
        }}
      >
        <PlusIcon />
      </button>

      <div style={{ flex: 1 }} />
      {/* A list is ordered by its headings, which it has and a board has not.
          So the button is here only where there is nothing else to press. */}
      {/* A roadmap draws no card, so there is nothing for it to arrange. */}
      {view && view.kind !== "roadmap" && (
        <button
          className={`${styles.pill} ${styles.tool} ${cardOpen ? styles.filterOn : ""}`}
          data-testid="card-button"
          aria-expanded={cardOpen}
          title={`Arrange what a card on ${view.name} carries`}
          onClick={onCard}
        >
          <span className={styles.toolMark}>
            <CardIcon size={13} />
          </span>
          <span className={styles.toolWord}>Card</span>
        </button>
      )}
      {view?.kind === "board" && <SortButton open={sortOpen} setOpen={setSortOpen} />}
      <FilterButton open={filterOpen} setOpen={setFilterOpen} />
      {/* A filtered board says how much of itself it is showing. "12 tasks"
          alone cannot tell you whether the other 28 exist. */}
      <span className={styles.count} data-testid="task-count">
        {shown === taskCount ? shown : `${shown} of ${taskCount}`}{" "}
        {taskCount === 1 ? "task" : "tasks"}
      </span>

      {menuOpen && view && (
        <ViewMenu
          view={view}
          anchor={moreRef}
          host={ref}
          onClose={() => setMenuFor(null)}
          onRename={() => {
            setMenuFor(null);
            setRenamingId(view.id);
          }}
          onCard={() => {
            if (!cardOpen) onCard();
          }}
        />
      )}

      {adding && (
        <div className={styles.popover} style={{ left: popLeft }}>
          <Label>New view</Label>
          <input
            className={styles.popInput}
            autoFocus
            value={name}
            aria-label="Name of the new view"
            placeholder="View name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") setAdding(false);
            }}
          />
          {/* The name box keeps the caret, so the block that comes and goes is
              the last one and nothing ever moves above the cursor. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Label>Shows as</Label>
            <div className={styles.chipRow} role="group" aria-label="What the new view shows">
              {VIEW_KINDS.map((option) => (
                <button
                  key={option}
                  className={`${styles.chip} ${kind === option ? styles.chipOn : ""}`}
                  aria-pressed={kind === option}
                  onClick={() => setKind(option)}
                >
                  <ViewKindMark kind={option} on={kind === option} color="#4b8fbe" />
                  {VIEW_KIND_LABEL[option]}
                </button>
              ))}
            </div>
          </div>

          {GROUPED_KINDS.includes(kind) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label id="new-view-columns">{kind === "roadmap" ? "Rows from" : "Columns by"}</Label>
              <div className={styles.chipRow} role="group" aria-labelledby="new-view-columns">
                {groupable.map((property) => (
                  <button
                    key={property.id}
                    className={`${styles.chip} ${groupById === property.id ? styles.chipOn : ""}`}
                    aria-pressed={groupById === property.id}
                    onClick={() => setGroupById(property.id)}
                  >
                    <span
                      className={styles.dot6}
                      style={{
                        background: property.options[0]?.color ?? "#4b8fbe",
                        opacity: groupById === property.id ? 1 : 0.45,
                      }}
                    />
                    {property.name}
                  </button>
                ))}
              </div>
              {groupable.length === 0 && (
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {kind === "roadmap"
                    ? "Create a select property first."
                    : "Create a select, person or checkbox property first."}
                </span>
              )}
              {kind === "roadmap" && groupable.length > 0 && (
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  One bar for each option with a target date.
                </span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              One row for each task, in the order the board already has.
            </span>
          )}
          <div className={styles.row}>
            <button className={styles.primary} onClick={() => void submit()}>
              Create view
            </button>
            <button className={styles.ghost} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          {/*
           * Deleting used to live on the active pill, which put a delete
           * control under the cursor that had just selected the view.
           */}
          <Link className={styles.popLink} href={`/p/${data.project.id}/settings/views`}>
            Change or delete a view →
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * One view in the strip. It picks the view on a click and changes the order on
 * a drag, and the two cannot be confused: the drag starts only after the
 * pointer has moved five pixels.
 *
 * The keyboard picks a view here and orders them in settings. A pill answers
 * Space and Enter the way every other button does, which is worth more in the
 * top bar than a second way to say the same thing.
 *
 * So the pill must not say otherwise. dnd-kit hands every sortable a role
 * description and a line of instructions for a keyboard drag, and this strip
 * has no keyboard sensor to keep that promise. Those two are dropped, and the
 * tooltip names the view, because a long name is cut short on the pill.
 *
 * The open view carries a second button beside it, "⋯", that opens its menu.
 * It is a button of its own and not a menu on the pill, so a click still
 * picks, a drag still moves, and Tab reaches it. It shows on hover and focus,
 * and always on a screen without a pointer to hover with.
 */
function ViewPill({
  view,
  active,
  onPick,
  moreRef,
  menuOpen,
  onMore,
  renaming,
  onRenamed,
}: {
  view: ViewDTO;
  active: boolean;
  onPick: () => void;
  moreRef?: React.RefObject<HTMLButtonElement | null>;
  menuOpen: boolean;
  onMore: () => void;
  renaming: boolean;
  onRenamed: () => void;
}) {
  const { updateView } = useBoard();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: view.id,
    transition: { duration: 190, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    disabled: renaming,
  });
  const color = active ? dotOf(view) : "#3f4650";
  const {
    "aria-roledescription": _roledescription,
    "aria-describedby": _describedby,
    ...buttonAttributes
  } = attributes;

  const pill = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLInputElement>(null);
  /* Escape puts the name back, and the blur that follows must not save it. */
  const kept = useRef(false);
  /* Enter and Escape hand the focus back to the pill. A click away keeps it
     where it went. */
  const refocus = useRef(false);
  /* Another tab can rename the view under the box, so only what this tab
     typed may be written back. */
  const [typed, setTyped] = useState(false);

  useEffect(() => {
    if (renaming) {
      box.current?.focus();
      box.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      pill.current?.focus();
    }
  }, [renaming]);

  /* The name saves on blur, and a closed tab sends no blur. */
  useSaveOnLeave(() => {
    const edit = renaming && typed ? editedText(box.current?.value ?? "", view.name) : null;
    return edit ? { method: "PATCH", url: `/api/views/${view.id}`, body: { name: edit } } : null;
  });

  function finish(value: string) {
    const edit = kept.current ? null : editedText(value, view.name);
    kept.current = false;
    setTyped(false);
    onRenamed();
    if (edit) void updateView(view.id, { name: edit });
  }

  return (
    <span
      ref={setNodeRef}
      className={[styles.pillWrap, isDragging ? styles.pillLifted : ""].filter(Boolean).join(" ")}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined,
      }}
    >
      {renaming ? (
        <input
          ref={box}
          className={styles.pillName}
          aria-label={`Name of the view ${view.name}`}
          defaultValue={view.name}
          size={Math.max(view.name.length, 6)}
          onChange={() => setTyped(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              refocus.current = true;
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              kept.current = true;
              refocus.current = true;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => finish(e.target.value)}
        />
      ) : (
        <button
          ref={pill}
          className={[styles.pill, active ? styles.pillActive : ""].filter(Boolean).join(" ")}
          data-testid="view-pill"
          title={view.name}
          aria-current={active ? "true" : undefined}
          onClick={onPick}
          {...buttonAttributes}
          {...listeners}
        >
          {/* The one place the two kinds sit side by side, so the mark earns its
            pixels. */}
          {view.kind !== "board" ? (
            <ViewKindMark kind={view.kind} on={active} color={color} />
          ) : (
            <span className={styles.pillDot} style={{ background: color }} />
          )}
          {view.name}
        </button>
      )}
      {active && !renaming && (
        <button
          ref={moreRef}
          className={styles.pillMore}
          aria-label={`More for ${view.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More"
          /* The menu closes on a press outside it, and this button is outside
             it. Without this the press would close the menu and the click
             would open it again. */
          onMouseDown={(e) => {
            if (menuOpen) e.stopPropagation();
          }}
          onTouchStart={(e) => {
            if (menuOpen) e.stopPropagation();
          }}
          onClick={onMore}
        >
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">
            <circle cx="2.5" cy="6" r="1.1" fill="currentColor" />
            <circle cx="6" cy="6" r="1.1" fill="currentColor" />
            <circle cx="9.5" cy="6" r="1.1" fill="currentColor" />
          </svg>
        </button>
      )}
    </span>
  );
}

/**
 * What can be done to the open view, one click from it. Each item makes the
 * same write the Views page makes, under the same guard: making a view main
 * and deleting one are an admin's, so a member is not offered them.
 *
 * It is drawn beside the strip and not inside it, because the strip pans and
 * would cut it off. Like the + panel it is placed by hand under its button.
 */
function ViewMenu({
  view,
  anchor,
  host,
  onClose,
  onRename,
  onCard,
}: {
  view: ViewDTO;
  anchor: React.RefObject<HTMLButtonElement | null>;
  host: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onRename: () => void;
  onCard: () => void;
}) {
  const { data, notify, updateView, setMainView, deleteView } = useBoard();
  const confirm = useConfirm();
  const admin = canManage(data.project.role);
  const groupable = data.properties.filter((p) =>
    view.kind === "roadmap" ? isSelect(p.type) : GROUPABLE_TYPES.includes(p.type),
  );

  /* The focus goes back to the "⋯" it came from, but only if it is still in
     the menu: a click elsewhere keeps where it went. */
  function close() {
    const inside = document.activeElement?.closest("[data-view-menu]") != null;
    onClose();
    if (inside) anchor.current?.focus();
  }
  const around = useDismiss<HTMLDivElement>(close, true);
  const menu = useRef<HTMLDivElement>(null);

  /* Placed straight on the element, so the menu is drawn once and in place. */
  useLayoutEffect(() => {
    if (!anchor.current || !host.current || !menu.current) return;
    const at = anchor.current.getBoundingClientRect();
    const box = host.current.getBoundingClientRect();
    const width = menu.current.offsetWidth;
    const left = Math.max(10, Math.min(at.left - box.left, box.width - width - 10));
    menu.current.style.left = `${left}px`;
  }, [anchor, host]);

  useEffect(() => {
    if (!confirm.asking) menu.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus();
  }, [confirm.asking]);

  function walk(e: React.KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (index + 1) % items.length;
    else if (e.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next]?.focus();
  }

  /** Runs the act, puts the menu away and hands the focus back. */
  function then(run: () => void) {
    return () => {
      close();
      run();
    };
  }

  /* The same words as a task's link, and the same shape as the address bar's,
     built from wherever the board is served. */
  async function copyLink() {
    const link = `${window.location.origin}/p/${data.project.id}?view=${view.id}`;
    if (await copyText(link)) notify("Link copied", "info");
    else notify("The link did not copy. The address bar holds it.");
  }

  const grouped = GROUPED_KINDS.includes(view.kind);

  return (
    <div ref={around} className={styles.viewMenuAround}>
      <div
        ref={menu}
        className={`${styles.popover} ${styles.viewMenu}`}
        data-view-menu=""
        role={confirm.asking ? undefined : "menu"}
        aria-label={`More for ${view.name}`}
        onKeyDown={walk}
      >
        {confirm.asking ? (
          <ConfirmRow
            question={`Delete the view ${view.name}? The tasks stay; only this way of looking at them goes.`}
            onConfirm={() => confirm.confirm(then(() => void deleteView(view.id)))}
            onCancel={confirm.cancel}
          />
        ) : (
          <>
            <button role="menuitem" tabIndex={-1} className={styles.menuItem} onClick={onRename}>
              Rename
            </button>
            {grouped && groupable.length > 0 && (
              <div
                role="group"
                aria-label={view.kind === "roadmap" ? "Rows from" : "Columns by"}
                className={styles.menuGroup}
              >
                <span className={styles.menuLabel} aria-hidden>
                  {view.kind === "roadmap" ? "Rows from" : "Columns by"}
                </span>
                {groupable.map((property) => (
                  <button
                    key={property.id}
                    role="menuitemradio"
                    aria-checked={view.groupById === property.id}
                    tabIndex={-1}
                    className={styles.menuItem}
                    onClick={then(() => {
                      if (view.groupById !== property.id)
                        void updateView(view.id, { groupById: property.id });
                    })}
                  >
                    <span className={styles.menuTick} aria-hidden>
                      {view.groupById === property.id ? "✓" : ""}
                    </span>
                    {property.name}
                  </button>
                ))}
              </div>
            )}
            {/* A roadmap draws no card, so it has nothing to arrange. */}
            {view.kind !== "roadmap" && (
              <button
                role="menuitem"
                tabIndex={-1}
                className={styles.menuItem}
                onClick={then(onCard)}
              >
                Card
              </button>
            )}
            <button
              role="menuitem"
              tabIndex={-1}
              className={styles.menuItem}
              onClick={then(() => void copyLink())}
            >
              Copy link
            </button>
            {admin && !view.isDefault && (
              <>
                <button
                  role="menuitem"
                  tabIndex={-1}
                  className={styles.menuItem}
                  title="The board opens on the main view, and it cannot be deleted."
                  onClick={then(() => void setMainView(view.id))}
                >
                  Make main
                </button>
                <button
                  role="menuitem"
                  tabIndex={-1}
                  className={`${styles.menuItem} ${styles.menuDanger}`}
                  onClick={confirm.ask}
                >
                  Delete
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
