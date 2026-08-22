"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { useBoard } from "@/components/board/store";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Card, Note, Row, Spacer } from "@/components/ui/Layout";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

export function ProjectPanel() {
  const { data, notify, refresh } = useBoard();
  const router = useRouter();
  const isOwner = data.project.role === "owner";

  const [name, setName] = useState(data.project.name);
  const [key, setKey] = useState(data.project.key);
  const [confirmText, setConfirmText] = useState("");
  const [confirming, setConfirming] = useState(false);

  const taskCount = data.tasks.length;
  const keyChanged = key !== data.project.key && key.length > 0;

  async function save(patch: { name?: string; key?: string }) {
    try {
      await api.patch(`/api/projects/${data.project.id}`, patch);
      await refresh();
      router.refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save.");
      setName(data.project.name);
      setKey(data.project.key);
    }
  }

  async function remove() {
    try {
      await api.del(`/api/projects/${data.project.id}`);
      router.replace("/projects");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not delete the project.");
    }
  }

  return (
    <>
      <PageHead title="Project" note="The name on the board and the prefix on every task key." />

      <Card>
        <Row>
          <Field label="Name" inline>
            <Input
              style={{ flex: 1, minWidth: 160 }}
              aria-label="Project name"
              value={name}
              disabled={!isOwner}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const trimmed = name.trim();
                if (!trimmed) return setName(data.project.name);
                if (trimmed !== data.project.name) void save({ name: trimmed });
              }}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Key" inline>
            <Input
              style={{ width: 110 }}
              aria-label="Project key"
              value={key}
              maxLength={6}
              disabled={!isOwner}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              onBlur={() => {
                if (!key) return setKey(data.project.key);
                if (key !== data.project.key) void save({ key });
              }}
            />
            <Note>Task keys look like {key || "USH"}-14.</Note>
          </Field>
        </Row>
        {/*
         * A task key is built from this prefix, never stored. Changing it
         * renames every task at once, which breaks every link somebody pasted
         * and every key an agent was told to work on.
         */}
        {keyChanged && taskCount > 0 && (
          <Row>
            <span className={styles.keyWarn} role="alert">
              ⚠ {taskCount} {taskCount === 1 ? "task is" : "tasks are"} called {data.project.key}-…
              today. Leaving this box renames all of them. Links and agent instructions that use the
              old key stop working.
            </span>
          </Row>
        )}
        {!isOwner && (
          <Row>
            <Note>Only the owner can change the name and the key.</Note>
          </Row>
        )}
      </Card>

      {isOwner && (
        <div className={styles.danger}>
          <span className={styles.dangerHead}>Delete this project</span>
          <Note>
            The board, its {taskCount} {taskCount === 1 ? "task" : "tasks"}, its properties, its
            views and its agents go with it. There is no undo.
          </Note>
          {confirming ? (
            <div className={styles.dangerRow}>
              <Note>
                Type <b>{data.project.key}</b> to confirm.
              </Note>
              <Input
                autoFocus
                style={{ width: 110 }}
                aria-label="Type the project key to confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
              />
              <Button
                variant="danger"
                disabled={confirmText !== data.project.key}
                onClick={() => void remove()}
              >
                Delete for good
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                  setConfirmText("");
                }}
              >
                Cancel
              </Button>
              <Spacer />
            </div>
          ) : (
            <div className={styles.dangerRow}>
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Delete project
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
