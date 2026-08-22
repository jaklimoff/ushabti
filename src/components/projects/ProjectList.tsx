"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { suggestProjectKey } from "@/lib/defaults";
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
  const [adding, setAdding] = useState(projects.length === 0);
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
          <div className={styles.title}>Projects</div>
        </div>

        {projects.length === 0 && !adding && (
          <div className={styles.empty}>
            You have no projects yet. Create one and the board arrives with a full set of properties
            you can rename or replace.
          </div>
        )}

        <div className={styles.grid}>
          {projects.map((project) => (
            <Link key={project.id} href={`/p/${project.id}`} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.key}>{project.key}</span>
                {project.role === "owner" && <span className={styles.cardMeta}>owner</span>}
              </div>
              <div className={styles.cardName}>{project.name}</div>
              <div className={styles.cardMeta}>
                {project.taskCount} {project.taskCount === 1 ? "task" : "tasks"} ·{" "}
                {project.memberCount} {project.memberCount === 1 ? "member" : "members"}
              </div>
            </Link>
          ))}

          {adding ? (
            <form className={styles.form} onSubmit={create}>
              <span className="label">New project</span>
              <input
                className={styles.input}
                value={name}
                autoFocus
                placeholder="Project name"
                onChange={(e) => {
                  setName(e.target.value);
                  if (!key) return;
                }}
              />
              <input
                className={styles.input}
                value={key}
                placeholder={name ? suggestProjectKey(name) : "Key, e.g. USH"}
                maxLength={6}
                onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              />
              {error && <div className={styles.error}>{error}</div>}
              <div className={styles.row}>
                <button className={styles.primary} type="submit" disabled={busy}>
                  {busy ? "Creating…" : "Create project"}
                </button>
                {projects.length > 0 && (
                  <button className={styles.ghost} type="button" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
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
