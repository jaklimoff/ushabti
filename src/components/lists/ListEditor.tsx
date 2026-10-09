"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { editedText, type LeaveSend } from "@/lib/leave";
import { LAST_SOURCE } from "@/lib/lists";
import type { SourceShape } from "@/lib/lists-load";
import type { FilterRule } from "@/lib/types";
import { RuleChips } from "@/components/board/Filters";
import { Button, ButtonPageLink, IconButton } from "@/components/ui/Button";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { Field, Input } from "@/components/ui/Form";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import type { SessionUser } from "@/components/ui/UserMenu";
import { ListBar } from "./ListPage";
import styles from "./lists.module.css";

type Project = { id: string; key: string; name: string };

/**
 * A list's name and its sources. The name saves on blur, as every field
 * does; each source is a project and the board's own filter chips. Deleting
 * the list asks in place, and takes no task with it.
 *
 * With no `list` it is a list nobody has saved: nothing is written until the
 * first project is picked, and that one request writes the list, its name
 * and the project together. `hidden` counts the sources of projects the
 * person left, which are not drawn but still keep the list from emptying.
 */
export function ListEditor({
  user,
  list,
  sources: initial,
  hidden = 0,
  projects,
}: {
  user: SessionUser;
  list: { id: string; name: string } | null;
  sources: SourceShape[];
  hidden?: number;
  projects: Project[];
}) {
  const router = useRouter();
  const [name, setName] = useState(list?.name ?? "New list");
  const [saved, setSaved] = useState(list?.name ?? "New list");
  /* Only what somebody typed here is owed on a closed tab. */
  const [typed, setTyped] = useState(false);
  const [sources, setSources] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const asking = useConfirm();
  /* Each source's writes are numbered, so an error from an older write does
     not speak over a newer one. */
  const writes = useRef(new Map<string, number>());

  const nameSend = (): LeaveSend | null => {
    if (!list) return null;
    const text = editedText(name, saved);
    return text ? { method: "PATCH", url: `/api/lists/${list.id}`, body: { name: text } } : null;
  };

  useSaveOnLeave(() => (typed ? nameSend() : null));

  async function saveName() {
    const send = nameSend();
    setTyped(false);
    if (!list) {
      setName(name.trim() || saved);
      return;
    }
    if (!send) {
      if (!name.trim()) setName(saved);
      return;
    }
    const text = (send.body as { name: string }).name;
    setSaved(text);
    setName(text);
    try {
      await api.patch(send.url, send.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the name.");
    }
  }

  function rulesSend(sourceId: string, rules: FilterRule[]): LeaveSend {
    return {
      method: "PATCH",
      url: `/api/lists/${list?.id}/sources/${sourceId}`,
      body: { filters: { rules } },
    };
  }

  async function setRules(sourceId: string, rules: FilterRule[]) {
    setSources((all) => all.map((s) => (s.id === sourceId ? { ...s, rules } : s)));
    const n = (writes.current.get(sourceId) ?? 0) + 1;
    writes.current.set(sourceId, n);
    const send = rulesSend(sourceId, rules);
    try {
      await api.patch(send.url, send.body);
    } catch (err) {
      if (writes.current.get(sourceId) === n) {
        setError(err instanceof Error ? err.message : "Could not save the rules.");
      }
    }
  }

  async function removeSource(sourceId: string) {
    if (!list) return;
    const before = sources;
    setSources((all) => all.filter((s) => s.id !== sourceId));
    try {
      await api.del(`/api/lists/${list.id}/sources/${sourceId}`);
    } catch (err) {
      /* The server keeps the last project; put back what it kept. */
      setSources(before);
      setError(err instanceof Error ? err.message : "Could not remove the project.");
    }
  }

  async function addSource(projectId: string) {
    if (adding) return;
    setAdding(true);
    setError(null);
    if (!list) {
      try {
        const made = await api.post<{ list: { id: string } }>("/api/lists", {
          name: name.trim() || saved,
          projectId,
        });
        /* The buttons stay held until the saved list's editor replaces this one. */
        router.replace(`/lists/${made.list.id}/edit`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not make the list.");
        setAdding(false);
      }
      return;
    }
    try {
      const { source } = await api.post<{ source: SourceShape }>(`/api/lists/${list.id}/sources`, {
        projectId,
      });
      setSources((all) => [...all, source]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the project.");
    } finally {
      setAdding(false);
    }
  }

  async function deleteList() {
    if (deleting || !list) return;
    setDeleting(true);
    try {
      await api.del(`/api/lists/${list.id}`);
      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the list.");
      setDeleting(false);
    }
  }

  const offered = projects.filter((p) => !sources.some((s) => s.projectId === p.id));
  const last = sources.length + hidden <= 1;

  return (
    <div className={styles.page}>
      <ListBar user={user} />
      <div className={styles.body}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{list ? "Edit list" : "New list"}</h1>
          <span className={styles.spacer} />
          {list && (
            <ButtonPageLink variant="ghost" href={`/lists/${list.id}`} data-testid="list-open">
              Open list
            </ButtonPageLink>
          )}
        </div>

        <Field label="Name">
          <Input
            block
            value={name}
            maxLength={80}
            aria-label="List name"
            data-testid="list-name"
            onChange={(e) => {
              setName(e.target.value);
              setTyped(true);
            }}
            onBlur={() => void saveName()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </Field>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <div className={styles.sources}>
          {sources.map((source) => (
            <section key={source.id} className={styles.source} data-testid="list-source-edit">
              <div className={styles.groupHead}>
                <span className={styles.key}>{source.key}</span>
                <span className={styles.groupName}>{source.name}</span>
                <span className={styles.spacer} />
                <IconButton
                  label={`Remove ${source.name} from the list`}
                  title={last ? LAST_SOURCE : undefined}
                  disabled={last}
                  data-testid="list-source-remove"
                  onClick={() => void removeSource(source.id)}
                >
                  ✕
                </IconButton>
              </div>
              {source.rules.length === 0 && (
                <span className={styles.none}>Every task of {source.key}.</span>
              )}
              <RuleChips
                properties={source.properties}
                members={source.members}
                former={source.former}
                rules={source.rules}
                onRules={(rules) => void setRules(source.id, rules)}
                owed={(rules) => rulesSend(source.id, rules)}
              />
            </section>
          ))}
        </div>

        <div className={styles.add}>
          <span className="label">Add a project</span>
          {sources.length + hidden === 0 && (
            <span className={styles.none} data-testid="list-needs-project">
              {list
                ? "This list reads no project. Pick one."
                : "Pick a project, and the list is made with it."}
            </span>
          )}
          {offered.length === 0 ? (
            <span className={styles.none}>
              {projects.length === 0
                ? "You are on no project yet."
                : "Every project of yours is on this list."}
            </span>
          ) : (
            <div className={styles.addRow}>
              {offered.map((p) => (
                <Button
                  key={p.id}
                  variant="ghost"
                  disabled={adding}
                  data-testid="list-add-project"
                  onClick={() => void addSource(p.id)}
                >
                  + {p.key} · {p.name}
                </Button>
              ))}
            </div>
          )}
        </div>

        {list && (
          <div className={styles.danger}>
            {asking.asking ? (
              <ConfirmRow
                question={`Delete ${saved}? The tasks stay; only the list goes.`}
                confirmLabel="Delete list"
                onConfirm={() => asking.confirm(() => void deleteList())}
                onCancel={asking.cancel}
              />
            ) : (
              <Button variant="danger" disabled={deleting} onClick={asking.ask}>
                Delete list
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
