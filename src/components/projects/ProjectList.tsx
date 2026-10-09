"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client";
import { suggestProjectKey } from "@/lib/defaults";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { Tag } from "@/components/ui/Layout";
import { UserMenu, type SessionUser } from "@/components/ui/UserMenu";
import { canManage } from "@/lib/roles";
import { longAgo } from "@/lib/board";
import { foldedOf, noFolds, subscribeFolded } from "@/lib/fold";
import { agentsLine, splitFolded, type ProjectPulse, type PulseColumn } from "@/lib/pulse";
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

export function ProjectList({
  user,
  projects,
  adding: asked = false,
}: {
  user: SessionUser;
  projects: ProjectRow[];
  adding?: boolean;
}) {
  const router = useRouter();
  const first = projects.length === 0;
  const [adding, setAdding] = useState(first || asked);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          <h1 className={styles.title}>Projects</h1>
        </div>

        {/*
         * This sentence used to be written and unreachable: `adding` starts
         * true when there are no projects, and the copy only rendered when it
         * was false. It now sits above the form, where it answers the question
         * the form asks.
         */}
        {first && (
          <p className={styles.empty}>
            A project is one board. It arrives with a full set of properties — Status, Priority,
            Assignee and the rest — and every one of them is yours to rename or delete.
          </p>
        )}

        <div className={styles.grid}>
          {projects.map((project) => (
            <div key={project.id} className={styles.cardWrap}>
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
              <Link
                href={`/p/${project.id}/settings/properties`}
                className={styles.cardGear}
                aria-label={`Settings for ${project.name}`}
                title="Project settings"
              >
                ⚙
              </Link>
            </div>
          ))}

          {adding ? (
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
                onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
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
                {projects.length > 0 && (
                  <Button variant="ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <button className={styles.newCard} onClick={() => setAdding(true)}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
              <span className="label" style={{ color: "inherit" }}>
                New project
              </span>
            </button>
          )}
        </div>
      </div>
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
