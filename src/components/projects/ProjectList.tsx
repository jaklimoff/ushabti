"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
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
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@/lib/client";
import { landedAfter } from "@/lib/landed";
import { suggestProjectKey } from "@/lib/defaults";
import { Button, ButtonPageLink, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { Tag } from "@/components/ui/Layout";
import { UserMenu, type SessionUser } from "@/components/ui/UserMenu";
import { canManage } from "@/lib/roles";
import { longAgo } from "@/lib/board";
import { foldedOf, noFolds, subscribeFolded } from "@/lib/fold";
import { agentsLine, splitFolded, type ProjectPulse, type PulseColumn } from "@/lib/pulse";
import type { ListSummary } from "@/lib/lists";
import type { ChartChoice, ChartDTO } from "@/lib/charts";
import { Charts } from "./Charts";
import { FirstProjectPanel, HomeSection, QuietPanel, WidePanel } from "./Empty";
import { useNow } from "@/components/ui/useElapsed";
import styles from "./ProjectList.module.css";

export type ProjectRow = {
  id: string;
  name: string;
  key: string;
  role: string;
  /** Questions and hand-overs, the switcher's number. */
  waiting: number;
  pulse?: ProjectPulse;
};

/**
 * Home: the person's projects, then their lists and charts. It keeps the address
 * the project list always had, so sign-in still lands here.
 */
export function ProjectList({
  user,
  projects,
  lists = [],
  charts = [],
  chartChoices = [],
  adding: asked = false,
}: {
  user: SessionUser;
  projects: ProjectRow[];
  lists?: ListSummary[];
  charts?: ChartDTO[];
  chartChoices?: ChartChoice[];
  adding?: boolean;
}) {
  const router = useRouter();
  const first = projects.length === 0;
  const [adding, setAdding] = useState(asked);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const order = useOrder(projects);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.post<{ project: { id: string } }>("/api/projects", {
        name: name.trim(),
        key: key.trim() || suggestProjectKey(name),
      });
      router.push(`/p/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <div className={styles.mark}>U</div>
        <div className={styles.brand}>Ushabti</div>
        <div className={styles.spacer} />
        <UserMenu user={user} />
      </div>

      <div className={styles.body}>
        <div className={styles.heading}>
          <h1 className={styles.title}>Home</h1>
        </div>

        <div className={styles.sections}>
          <HomeSection
            title="Projects"
            lead
            count={projects.length}
            adding={adding}
            create={
              !adding && (
                <Button
                  variant="text"
                  className={styles.headButton}
                  onClick={() => setAdding(true)}
                >
                  + New project
                </Button>
              )
            }
            empty={<FirstProjectPanel onCreate={() => setAdding(true)} />}
          >
            {order.error && (
              <div className={styles.error} role="alert">
                {order.error}
              </div>
            )}

            {(!first || adding) && (
              <div className={styles.grid}>
                {/* Cards of one size in a grid, so dnd-kit's own answers are the
              right ones, as on the views page. */}
                <DndContext
                  id="ushabti-projects"
                  sensors={order.sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={order.onDragEnd}
                >
                  <SortableContext
                    items={order.rows.map((p) => p.id)}
                    strategy={rectSortingStrategy}
                  >
                    {order.rows.map((project) => (
                      <ProjectCard key={project.id} project={project} />
                    ))}
                  </SortableContext>
                </DndContext>

                {adding && (
                  <form className={styles.form} onSubmit={create}>
                    <span className="label">New project</span>
                    <Input
                      block
                      autoFocus
                      value={name}
                      aria-label="Project name"
                      placeholder="Project name"
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => {
                        // A suggestion you can edit beats one that flickers in grey
                        // as you type and looks disabled.
                        if (!key && name.trim()) setKey(suggestProjectKey(name));
                      }}
                    />
                    <Input
                      block
                      value={key}
                      aria-label="Project key"
                      placeholder="Key, e.g. USH"
                      maxLength={6}
                      invalid={error !== null}
                      onChange={(e) =>
                        setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                      }
                    />
                    <span className={styles.hint}>Task keys look like {key || "USH"}-14.</span>
                    {error && (
                      <div className={styles.error} role="alert">
                        {error}
                      </div>
                    )}
                    <div className={styles.row}>
                      <Button type="submit" disabled={busy}>
                        {busy ? "Creating…" : "Create project"}
                      </Button>
                      <Button variant="ghost" onClick={() => setAdding(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </HomeSection>

          <MyLists lists={lists} canMake={!first} />

          <Charts charts={charts} choices={chartChoices} canMake={!first} />
        </div>
      </div>
    </div>
  );
}

/**
 * This person's order of their projects. A drag names the project it landed
 * after and the route makes the rank, as a view's drag does. The moves go out
 * one after another, so a quick second drag cannot reach the server first and
 * leave it with an order the screen does not show.
 */
function useOrder(projects: ProjectRow[]) {
  const router = useRouter();
  const [rows, setRows] = useState(projects);
  const [given, setGiven] = useState(projects);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /* A new read from the server is the truth, and replaces what was dragged. */
  if (given !== projects) {
    setGiven(projects);
    setRows(projects);
  }

  /* The grip is the only thing that lifts a card, so a click on the card
     still opens the board. Space lifts, the arrows move, Space puts it down. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const id = String(active.id);
    const landed = landedAfter(rows, id, String(over.id));
    if (!landed) return;
    setRows(landed.ordered);
    setError(null);
    queue.current = queue.current.then(async () => {
      try {
        await api.patch(`/api/projects/${id}/position`, { afterId: landed.afterId });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not move the project.");
        router.refresh();
      }
    });
  }

  return { rows, error, sensors, onDragEnd };
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: project.id,
    transition: { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });
  return (
    <div
      ref={setNodeRef}
      className={[styles.cardWrap, isDragging ? styles.cardLifted : ""].filter(Boolean).join(" ")}
      style={{ transform: CSS.Translate.toString(transform), transition: transition ?? undefined }}
      data-testid="project-card"
    >
      <Link href={`/p/${project.id}`} className={styles.card}>
        <div className={styles.cardTop}>
          <span className={styles.key}>{project.key}</span>
          {canManage(project.role) && <Tag>{project.role}</Tag>}
          {project.waiting > 0 && (
            <span className={styles.waiting} data-testid="project-waiting">
              {project.waiting} waiting for you
            </span>
          )}
        </div>
        <div className={styles.cardName}>{project.name}</div>
        {project.pulse && <Pulse pulse={project.pulse} />}
      </Link>
      <div className={styles.cardTools}>
        <IconButton
          ref={setActivatorNodeRef}
          className={styles.cardGrip}
          label={`Move the project ${project.name}`}
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
        </IconButton>
        <Link
          href={`/p/${project.id}/settings/properties`}
          className={styles.cardGear}
          aria-label={`Settings for ${project.name}`}
          title="Project settings"
        >
          ⚙
        </Link>
      </div>
    </div>
  );
}

/**
 * The lists this person made. A card is a short copy of the list page: its
 * first rows in the page's order, and how many more there are. It is not one
 * link around everything, because a row is a link of its own.
 */
function MyLists({ lists, canMake }: { lists: ListSummary[]; canMake: boolean }) {
  return (
    <HomeSection
      title="My lists"
      count={lists.length}
      data-testid="my-lists"
      create={
        <ButtonPageLink
          href="/lists/new"
          variant="text"
          className={styles.headButton}
          data-testid="list-new"
        >
          + New list
        </ButtonPageLink>
      }
      empty={
        canMake ? (
          <WidePanel
            label="+ New list"
            hint="Tasks from any of your projects in one place, picked by rules, such as everything in Todo."
            shapes="rows"
            href="/lists/new"
            data-testid="list-new"
          />
        ) : (
          <QuietPanel
            title="Lists"
            line="Gather tasks from your projects in one place. Create a project first."
          />
        )
      }
    >
      {lists.length > 0 && (
        <div className={`${styles.grid} ${styles.listGrid}`}>
          {lists.map((list) => (
            <ListCard key={list.id} list={list} />
          ))}
        </div>
      )}
    </HomeSection>
  );
}

/** Every card is as tall as a full one, so a list that fills does not move the row. */
function ListCard({ list }: { list: ListSummary }) {
  const more = list.count - list.rows.length;
  return (
    <div className={`${styles.card} ${styles.listCard}`} data-testid="list-card">
      <div className={styles.cardTop}>
        <Link href={`/lists/${list.id}`} className={styles.listName} data-testid="list-name-link">
          {list.name}
        </Link>
        <span className={styles.listCount} data-testid="list-count">
          {list.count}
        </span>
      </div>
      {list.rows.length === 0 ? (
        <span className={styles.listEmpty} data-testid="list-empty">
          Nothing here.
        </span>
      ) : (
        <ul className={styles.listRows}>
          {list.rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/p/${row.projectId}?task=${row.key}`}
                className={styles.listRow}
                data-testid="list-card-row"
              >
                <span className={styles.listRowKey}>{row.key}</span>
                <span className={styles.listRowTitle}>{row.title}</span>
                {row.waiting && <span className={styles.listWaiting}>Waiting for you</span>}
                {row.agent && (
                  <span className={styles.listAgent} title="At work on it">
                    <span className={styles.listAgentDot} aria-hidden="true" />
                    {row.agent}
                  </span>
                )}
              </Link>
            </li>
          ))}
          {more > 0 && (
            <li>
              <Link
                href={`/lists/${list.id}`}
                className={styles.listMore}
                data-testid="list-card-more"
              >
                +{more} more
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * How the project is going: its main view's columns as a bar and a line of
 * counts, then who works on it and the last thing that changed. The line names
 * every column with its count, because a colour must never carry the meaning
 * alone. What this person folded on that view is read here, after the page
 * draws, exactly as the board reads it: the server cannot know a browser.
 */
function Pulse({ pulse }: { pulse: ProjectPulse }) {
  const folded = useSyncExternalStore(subscribeFolded, () => foldedOf(pulse.viewId ?? ""), noFolds);
  const now = useNow(false);
  const agents = agentsLine(pulse.agents);
  return (
    <>
      {pulse.columns && <Columns columns={pulse.columns} folded={folded} />}
      {(agents || pulse.last) && (
        <div className={styles.cardFoot} data-testid="project-foot">
          {agents && <span data-testid="project-agents">{agents}</span>}
          {pulse.last && (
            <span className={styles.last} data-testid="project-last">
              <span suppressHydrationWarning>{longAgo(pulse.last.at, now)}</span>
              {pulse.last.who && <> · {pulse.last.who}</>}
              {pulse.last.taskKey && <> · {pulse.last.taskKey}</>}
            </span>
          )}
        </div>
      )}
    </>
  );
}

function Columns({ columns, folded }: { columns: PulseColumn[]; folded: readonly string[] }) {
  const { open, aside } = splitFolded(columns, folded);
  const total = open.reduce((sum, c) => sum + c.count, 0);
  return (
    <div className={styles.pulse}>
      {/* The words under it say the same, so the bar is not read out twice. */}
      <div className={styles.track} aria-hidden="true" data-testid="project-bar">
        {total > 0 &&
          open
            .filter((c) => c.count > 0)
            .map((c) => (
              <span
                key={c.id}
                className={styles.share}
                style={{ flexGrow: c.count, background: c.color }}
                data-column={c.name}
              />
            ))}
      </div>
      <div className={styles.counts} data-testid="project-columns">
        {open.map((c) => (
          <span key={c.id} className={styles.count} data-testid="project-column">
            {c.name} {c.count}
          </span>
        ))}
        {aside.map((c) => (
          <span key={c.id} className={styles.aside} data-testid="project-folded">
            + {c.name} {c.count}
          </span>
        ))}
      </div>
    </div>
  );
}
