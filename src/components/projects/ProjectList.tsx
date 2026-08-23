"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { suggestProjectKey } from "@/lib/defaults";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { Tag } from "@/components/ui/Layout";
import { UserMenu, type SessionUser } from "@/components/ui/UserMenu";
import styles from "./ProjectList.module.css";

export type ProjectRow = {
  id: string;
  name: string;
  key: string;
  role: string;
  taskCount: number;
  memberCount: number;
};

export function ProjectList({ user, projects }: { user: SessionUser; projects: ProjectRow[] }) {
  const router = useRouter();
  const first = projects.length === 0;
  const [adding, setAdding] = useState(first);
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
                  {project.role === "owner" && <Tag>owner</Tag>}
                </div>
                <div className={styles.cardName}>{project.name}</div>
                <div className={styles.cardMeta}>
                  {project.taskCount} {project.taskCount === 1 ? "task" : "tasks"} ·{" "}
                  {project.memberCount} {project.memberCount === 1 ? "member" : "members"}
                </div>
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
