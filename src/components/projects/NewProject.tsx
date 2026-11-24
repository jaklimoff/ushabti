"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { suggestProjectKey } from "@/lib/defaults";
import { Button, ButtonPageLink } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import type { SessionUser } from "@/components/ui/UserMenu";
import { AppBar, AppCrumb } from "@/components/ui/AppBar";
import { FormActions, PageHead, PageShell } from "@/components/ui/Layout";
import styles from "./NewProject.module.css";

/**
 * The page that makes a project. It used to be a form at the end of Home's
 * grid, often below the fold, so a press on New project read as doing
 * nothing. Nothing is sent until **Create project**: this is a form that makes
 * a thing, not a field that saves on blur.
 */
export function NewProject({ user }: { user: SessionUser }) {
  return (
    <div className={styles.page}>
      <AppBar user={user} trail={[<AppCrumb key="here">New project</AppCrumb>]} />
      <PageShell width="narrow">
        <PageHead
          title="New project"
          lead="A project is one board of tasks, shared with the people and agents you invite."
        />
        <NewProjectForm />
      </PageShell>
    </div>
  );
}

/**
 * The key stays empty until the name is left, so it never flickers as
 * somebody types; the note under it follows the name instead, so the example
 * is theirs from the start.
 */
export function NewProjectForm() {
  const router = useRouter();
  const nameBox = useRef<HTMLInputElement>(null);
  /* Held at once, before the state that marks the button busy has drawn. */
  const held = useRef(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sample = key || (name.trim() ? suggestProjectKey(name) : "WR");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (held.current) return;
    if (!name.trim()) {
      setNameError("Give the project a name.");
      nameBox.current?.focus();
      return;
    }
    held.current = true;
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.post<{ project: { id: string } }>("/api/projects", {
        name: name.trim(),
        key: key.trim() || suggestProjectKey(name),
      });
      /* The button stays held until the board replaces this page. */
      router.push(`/p/${project.id}`);
    } catch (err) {
      const said = err instanceof Error ? err.message : "Could not create the project.";
      /* The answer lands on the box it is about. */
      if (/name/i.test(said)) setNameError(said);
      else setError(said);
      held.current = false;
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={create} aria-label="New project" noValidate>
      <Field label="Name" error={nameError}>
        <Input
          ref={nameBox}
          block
          autoFocus
          value={name}
          aria-label="Project name"
          placeholder="Project name"
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          onBlur={() => {
            // A suggestion you can edit beats one that flickers in grey
            // as you type and looks disabled.
            if (!key && name.trim()) setKey(suggestProjectKey(name));
          }}
        />
      </Field>
      <Field
        label="Key"
        error={error}
        note={`Task keys will look like ${sample}-14. Changing the key later renames every task.`}
      >
        <Input
          block
          value={key}
          aria-label="Project key"
          placeholder="e.g. WR"
          maxLength={6}
          onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        />
      </Field>
      <FormActions>
        <ButtonPageLink variant="ghost" href="/projects">
          Cancel
        </ButtonPageLink>
        <Button type="submit" busy={busy}>
          {busy ? "Creating…" : "Create project"}
        </Button>
      </FormActions>
    </form>
  );
}
