"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { NAME_MAX } from "@/lib/lists";
import type { SourceShape } from "@/lib/lists-load";
import type { FilterRule } from "@/lib/types";
import { RuleChips } from "@/components/board/Filters";
import { Button, ButtonPageLink, IconButton } from "@/components/ui/Button";
import { Field, Input, Label } from "@/components/ui/Form";
import type { SessionUser } from "@/components/ui/UserMenu";
import { ListBar } from "./ListPage";
import { AppCrumb } from "@/components/ui/AppBar";
import { PageHead, PageShell } from "@/components/ui/Layout";
import { ProjectMark } from "@/components/ui/Marks";
import { ProjectTiles } from "./ProjectTiles";
import styles from "./lists.module.css";

type Project = { id: string; key: string; name: string; color: string };

/** One picked project: its rules, and what the server last read of them. */
type Pick = {
  projectId: string;
  rules: FilterRule[];
  shape: SourceShape | null;
  count: number | null;
  failed: string | null;
};

/** From this many projects on, a box finds one by name or key. */
export const FIND_FROM = 10;

const several = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * A list nobody has saved. Its projects and their rules are picked here, and
 * each picked project says how many tasks it gives, but nothing is written
 * until **Create list**, which writes it all in one request. So nothing here
 * saves on a blur, and nothing is owed to a closed tab.
 */
export function NewList({ user, projects }: { user: SessionUser; projects: Project[] }) {
  const router = useRouter();
  const only = projects.length === 1;
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState<Pick[]>(() =>
    only ? [{ projectId: projects[0].id, rules: [], shape: null, count: null, failed: null }] : [],
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Each project's reads are numbered, so an answer to older rules, or to a
     pick since undone, never lands on the card. */
  const asked = useRef(new Map<string, number>());
  /* Held at once, before the state that disables the button has drawn. */
  const held = useRef(false);

  async function read(projectId: string, rules: FilterRule[]) {
    const n = (asked.current.get(projectId) ?? 0) + 1;
    asked.current.set(projectId, n);
    const fresh = () => asked.current.get(projectId) === n;
    try {
      const answer = await api.post<{ source: SourceShape; count: number }>("/api/lists/preview", {
        projectId,
        filters: { rules },
      });
      if (!fresh()) return;
      setPicks((all) =>
        all.map((p) =>
          p.projectId === projectId
            ? { ...p, shape: answer.source, count: answer.count, failed: null }
            : p,
        ),
      );
    } catch (err) {
      if (!fresh()) return;
      const said = err instanceof Error ? err.message : "Could not count the tasks.";
      setPicks((all) => all.map((p) => (p.projectId === projectId ? { ...p, failed: said } : p)));
    }
  }

  useEffect(() => {
    if (only) void read(projects[0].id, []);
    // Only the pick made for the person on load is read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(projectId: string) {
    if (picks.some((p) => p.projectId === projectId)) return unpick(projectId);
    setPicks((all) => [...all, { projectId, rules: [], shape: null, count: null, failed: null }]);
    void read(projectId, []);
  }

  function unpick(projectId: string) {
    asked.current.set(projectId, (asked.current.get(projectId) ?? 0) + 1);
    setPicks((all) => all.filter((p) => p.projectId !== projectId));
  }

  function setRules(projectId: string, rules: FilterRule[]) {
    setPicks((all) => all.map((p) => (p.projectId === projectId ? { ...p, rules } : p)));
    void read(projectId, rules);
  }

  async function create() {
    if (held.current || picks.length === 0) return;
    held.current = true;
    setCreating(true);
    setError(null);
    try {
      const made = await api.post<{ list: { id: string } }>("/api/lists", {
        name: name.trim(),
        sources: picks.map((p) => ({ projectId: p.projectId, filters: { rules: p.rules } })),
      });
      /* The button stays held until the list's page replaces this one. */
      router.push(`/lists/${made.list.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not make the list.");
      held.current = false;
      setCreating(false);
    }
  }

  const wanted = query.trim().toLowerCase();
  const shown = wanted
    ? projects.filter(
        (p) => p.name.toLowerCase().includes(wanted) || p.key.toLowerCase().includes(wanted),
      )
    : projects;
  const projectOf = (id: string) => projects.find((p) => p.id === id);
  const rules = picks.reduce((sum, p) => sum + p.rules.length, 0);
  const tasks = picks.reduce((sum, p) => sum + (p.count ?? 0), 0);

  return (
    <div className={styles.page}>
      <ListBar user={user} trail={[<AppCrumb key="here">New list</AppCrumb>]} />
      <PageShell>
        <PageHead title="New list" />

        <Field label="Name" note="Left empty, it is named after its projects.">
          <Input
            block
            size="lg"
            value={name}
            maxLength={NAME_MAX}
            placeholder="My week"
            aria-label="List name"
            data-testid="list-name"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <section className={styles.add} aria-labelledby="list-projects">
          <Label id="list-projects">Projects</Label>
          {projects.length >= FIND_FROM && (
            <Input
              block
              value={query}
              placeholder="Find a project"
              aria-label="Find a project"
              data-testid="list-find"
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {projects.length === 0 ? (
            <span className={styles.none}>You are on no project yet.</span>
          ) : shown.length === 0 ? (
            <span className={styles.none} data-testid="list-find-none">
              No project matches “{query.trim()}”.
            </span>
          ) : (
            <ProjectTiles
              projects={shown}
              picked={(id) => picks.some((s) => s.projectId === id)}
              onPick={toggle}
            />
          )}
          {only && <span className={styles.none}>Your only project, picked for you.</span>}
        </section>

        <section className={styles.add} aria-labelledby="list-gathers">
          <Label id="list-gathers">What it gathers</Label>
          {picks.length === 0 ? (
            <span className={styles.none} data-testid="list-needs-project">
              Pick a project above. Nothing is written until you press Create.
            </span>
          ) : (
            <div className={styles.sources}>
              {picks.map((pick) => {
                const project = projectOf(pick.projectId);
                if (!project) return null;
                const nothing = pick.count === 0 && pick.rules.length > 0;
                return (
                  <section
                    key={pick.projectId}
                    className={styles.source}
                    data-testid="list-source-edit"
                  >
                    <div className={styles.groupHead}>
                      <ProjectMark projectKey={project.key} color={project.color} />
                      <span className={styles.groupName}>{project.name}</span>
                      <span
                        className={nothing ? styles.countNone : styles.groupCount}
                        data-testid="list-source-count"
                      >
                        {pick.count === null ? "…" : several(pick.count, "task")}
                      </span>
                      <span className={styles.spacer} />
                      <IconButton
                        label={`Remove ${project.name} from the list`}
                        data-testid="list-source-remove"
                        onClick={() => unpick(pick.projectId)}
                      >
                        ✕
                      </IconButton>
                    </div>
                    {pick.failed && (
                      <span className={styles.error} role="alert">
                        {pick.failed}
                      </span>
                    )}
                    {pick.rules.length === 0 && (
                      <span className={styles.none}>
                        Every task of {project.key}. Add a rule to narrow it.
                      </span>
                    )}
                    {nothing && (
                      <span className={styles.warn} data-testid="list-source-nothing">
                        No task passes these rules. The list will show nothing from {project.key}.
                      </span>
                    )}
                    {pick.shape && (
                      <RuleChips
                        bare
                        properties={pick.shape.properties}
                        members={pick.shape.members}
                        former={pick.shape.former}
                        rules={pick.rules}
                        onRules={(next) => setRules(pick.projectId, next)}
                        owed={() => null}
                      />
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </section>

        {/* The two buttons are one group, so on a phone they wrap together and
            Create stays at the right. The sum shows once there is one. */}
        <div className={styles.footer}>
          {picks.length > 0 && (
            <span className={styles.summary} data-testid="list-summary">
              {[
                several(picks.length, "project"),
                rules > 0 ? several(rules, "rule") : null,
                several(tasks, "task"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
          {error && (
            <span className={styles.error} role="alert">
              {error}
            </span>
          )}
          <div className={styles.footActions}>
            <ButtonPageLink variant="ghost" href="/projects">
              Cancel
            </ButtonPageLink>
            <Button
              disabled={picks.length === 0 || creating}
              data-testid="list-create"
              onClick={() => void create()}
            >
              Create list
            </Button>
          </div>
        </div>
      </PageShell>
    </div>
  );
}
