"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { canManage, isOwner as isOwnerRole } from "@/lib/roles";
import { editedText } from "@/lib/leave";
import type { DoneWhen } from "@/lib/links";
import { useBoard } from "@/components/board/store";
import { Button } from "@/components/ui/Button";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { Field, Input, Select } from "@/components/ui/Form";
import { Card, Note, Row, Spacer } from "@/components/ui/Layout";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

export function ProjectPanel() {
  const { data, notify, refresh, send } = useBoard();
  const router = useRouter();
  const canEdit = canManage(data.project.role);
  /* Deleting the project stays the owner's alone, which is what an admin is
     for: everything else, without the power to end the board. */
  const isOwner = isOwnerRole(data.project.role);

  const [name, setName] = useState(data.project.name);
  const [key, setKey] = useState(data.project.key);
  const [zone, setZone] = useState(data.project.timeZone);
  /* Each box mirrors what is saved, and the mirror goes stale when somebody
     else changes it. So a box says whether this tab typed in it since its
     last save: nothing else may be written back. */
  const [typedName, setTypedName] = useState(false);
  const [typedKey, setTypedKey] = useState(false);
  const [typedZone, setTypedZone] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [confirming, setConfirming] = useState(false);

  /* Every task of the project, archived ones too: a rename renames their keys
     as well, and a delete takes them with it. */
  const taskCount = data.tasks.length + data.archived.length;
  const keyChanged = key !== data.project.key && key.length > 0;

  /*
   * What this project calls done. A blocker that is over stops blocking, and
   * no status is hardcoded, so the owner says which option means it. Only a
   * select can answer: a date or a number has no option to point at.
   */
  const doneWhen = data.project.doneWhen;
  const selects = data.properties.filter((p) => p.type === "select" && p.options.length > 0);
  /*
   * Picking a property asks the question; the option answers it, exactly as a
   * filter does. So the property lives here until the option is chosen —
   * nothing is saved in between, because a half-made answer is not one. Null
   * means "whatever is saved", so another tab's change still shows.
   */
  const [pickedId, setPickedId] = useState<string | null>(null);
  const doneProperty = selects.find((p) => p.id === (pickedId ?? doneWhen?.propertyId)) ?? null;

  /*
   * What each box still owes. A blur saves it; a closed tab sends no blur, so
   * the same answer goes out on the way off the page.
   */
  const url = `/api/projects/${data.project.id}`;
  const nameEdit = typedName ? editedText(name, data.project.name) : null;
  const keyEdit = typedKey ? editedText(key, data.project.key) : null;
  const zoneEdit = typedZone ? editedText(zone, data.project.timeZone) : null;
  useSaveOnLeave(() => (nameEdit ? { method: "PATCH", url, body: { name: nameEdit } } : null));
  useSaveOnLeave(() => (keyEdit ? { method: "PATCH", url, body: { key: keyEdit } } : null));
  useSaveOnLeave(() => (zoneEdit ? { method: "PATCH", url, body: { timeZone: zoneEdit } } : null));

  async function save(patch: {
    name?: string;
    key?: string;
    doneWhen?: DoneWhen | null;
    timeZone?: string;
  }) {
    try {
      await send.patch(url, patch);
      await refresh();
      router.refresh();
    } catch (err) {
      /* The server is the one place that knows which zone names this
         runtime has, so its sentence is the one the row says. */
      notify(err instanceof Error ? err.message : "Could not save.");
      setName(data.project.name);
      setKey(data.project.key);
      setZone(data.project.timeZone);
    }
  }

  async function remove() {
    try {
      await send.del(`/api/projects/${data.project.id}`);
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
              disabled={!canEdit}
              onChange={(e) => {
                setName(e.target.value);
                setTypedName(true);
              }}
              onBlur={() => {
                setTypedName(false);
                if (!name.trim()) return setName(data.project.name);
                if (nameEdit) void save({ name: nameEdit });
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
              disabled={!canEdit}
              onChange={(e) => {
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                setTypedKey(true);
              }}
              onBlur={() => {
                setTypedKey(false);
                if (!key) return setKey(data.project.key);
                if (keyEdit) void save({ key: keyEdit });
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
        {!canEdit && (
          <Row>
            <Note>Only the owner or an admin can change the name and the key.</Note>
          </Row>
        )}
      </Card>

      {/*
       * Which day a relative date rule means.
       *
       * A shared filter that says "due this week" has to mean one week for
       * the whole team, so the day is the project's and not the reader's: two
       * browsers in two zones would otherwise see different cards through one
       * view, and an agent has no browser at all. The box takes a name and
       * the server refuses one it does not know, because the list of zones
       * belongs to the machine that works the day out.
       */}
      <Card>
        <Row>
          <Field label="Time zone" inline>
            <Input
              style={{ width: 220 }}
              aria-label="The time zone this project's day is worked out in"
              value={zone}
              disabled={!canEdit}
              onChange={(e) => {
                setZone(e.target.value);
                setTypedZone(true);
              }}
              onBlur={() => {
                setTypedZone(false);
                if (!zone.trim()) return setZone(data.project.timeZone);
                if (zoneEdit) void save({ timeZone: zoneEdit });
              }}
            />
            <Note>
              Today is {data.today} here. A filter that says <b>Due this week</b> or <b>Overdue</b>{" "}
              is worked out in this zone, for everybody on the board.
            </Note>
          </Field>
        </Row>
        {!canEdit && (
          <Row>
            <Note>Only the owner or an admin can change the time zone of this project.</Note>
          </Row>
        )}
      </Card>

      {/*
       * The two boxes are one answer, so they sit on one row. Picking a
       * property with no option yet writes nothing: the answer is the option.
       * Both boxes save the moment they change — a dropdown has no draft to
       * lose, so the change is its blur.
       */}
      <Card>
        <Row>
          <Field label="Done when" inline>
            <Select
              aria-label="The property that says a task is done"
              value={doneProperty?.id ?? ""}
              disabled={!canEdit || selects.length === 0}
              onChange={(e) => {
                /* The same property again is the same question, so it is not
                   asked twice: re-picking it would otherwise throw away the
                   option that is already the answer. */
                if (e.target.value === (doneProperty?.id ?? "")) return;
                setPickedId(e.target.value);
                /* Another property is another question, so the old answer
                   goes now rather than when the new one arrives. */
                void save({ doneWhen: null });
              }}
            >
              <option value="">Archived only</option>
              {selects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            {doneProperty && (
              <Select
                aria-label="The option that says a task is done"
                value={doneWhen?.optionId ?? ""}
                disabled={!canEdit}
                onChange={(e) =>
                  void save({
                    doneWhen: e.target.value
                      ? { propertyId: doneProperty.id, optionId: e.target.value }
                      : null,
                  })
                }
              >
                <option value="">Pick one</option>
                {doneProperty.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
            <Note>
              A task that blocks another stops blocking when it is archived, or when it reaches
              this.
            </Note>
          </Field>
        </Row>
        {selects.length === 0 && (
          <Row>
            <Note>This board has no select property with options, so archived is the answer.</Note>
          </Row>
        )}
        {!canEdit && (
          <Row>
            <Note>Only the owner or an admin can change what this project calls done.</Note>
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
