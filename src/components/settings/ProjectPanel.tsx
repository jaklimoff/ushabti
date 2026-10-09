"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changelogSlug } from "@/lib/changelog";
import { canManage, isOwner as isOwnerRole } from "@/lib/roles";
import { editedText } from "@/lib/leave";
import { AGENT_RULES_MAX, AGENT_RULES_SOFT, rulesCount } from "@/lib/agent-rules";
import type { DoneWhen } from "@/lib/links";
import { offQuestion } from "@/lib/plan-switch";
import { CADENCE_DEFAULT } from "@/lib/cadence";
import { useBoard } from "@/components/board/store";
import { Button, ButtonLink } from "@/components/ui/Button";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { Checkbox, Field, Input, Select, TextArea } from "@/components/ui/Form";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { Card, Note, Row, Section, Spacer } from "@/components/ui/Layout";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";
import { isSelect } from "@/lib/types";
import { FILES_OFF_NOTE } from "@/lib/attachments";

/** `files` is whether the server has a bucket for attachments; off, the page says what to set. */
export function ProjectPanel({ files }: { files: boolean }) {
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
  /* A person always reads the rules on the board; only an agent's is null. */
  const savedRules = data.project.agentRules ?? "";
  const [rules, setRules] = useState(savedRules);
  const [typedRules, setTypedRules] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [confirming, setConfirming] = useState(false);
  /* A press waits for its answer, so a second press cannot flip it back. */
  const [switching, setSwitching] = useState(false);
  const release = data.properties.find((p) => p.id === data.project.releaseBy) ?? null;
  const sprint = data.properties.find((p) => p.id === data.project.sprintBy) ?? null;
  const releasesOff = useConfirm();
  const sprintsOff = useConfirm();
  /* What the cadence starts from. Nothing is saved until the switch. */
  const [sprintLength, setSprintLength] = useState(String(CADENCE_DEFAULT.length));
  const [sprintStart, setSprintStart] = useState(data.today);
  /* A press waits for its answer before it counts again: a second press on a
     switch that has not answered yet would flip it back. */
  const [flipping, setFlipping] = useState(false);

  /* Every task of the project, archived ones too: a rename renames their keys
     as well, and a delete takes them with it. */
  const taskCount = data.taskCount ?? data.tasks.length + data.archived.length;
  const keyChanged = key !== data.project.key && key.length > 0;

  /*
   * What this project calls done. A blocker that is over stops blocking, and
   * no status is hardcoded, so the owner says which option means it. Only a
   * select can answer: a date or a number has no option to point at.
   */
  const doneWhen = data.project.doneWhen;
  const selects = data.properties.filter((p) => isSelect(p.type) && p.options.length > 0);
  /*
   * Picking a property asks the question; the option answers it, exactly as a
   * filter does. So the property lives here until the option is chosen —
   * nothing is saved in between, because a half-made answer is not one. Null
   * means "whatever is saved", so another tab's change still shows.
   */
  const [pickedId, setPickedId] = useState<string | null>(null);
  const doneProperty = selects.find((p) => p.id === (pickedId ?? doneWhen?.propertyId)) ?? null;
  /*
   * Each tick writes the whole list, worked out from the saved one, so a
   * second tick waits for the first answer rather than writing over it. The
   * list on its way out is what the ticks show until the answer lands.
   */
  const savedTicks = doneWhen?.propertyId === doneProperty?.id ? (doneWhen?.optionIds ?? []) : [];
  const [sendingTicks, setSendingTicks] = useState<string[] | null>(null);
  const ticks = sendingTicks ?? savedTicks;
  async function tickDone(optionId: string, on: boolean) {
    if (!doneProperty || sendingTicks) return;
    const next = doneProperty.options
      .map((o) => o.id)
      .filter((id) => (id === optionId ? on : savedTicks.includes(id)));
    setSendingTicks(next);
    try {
      await save({
        doneWhen: next.length ? { propertyId: doneProperty.id, optionIds: next } : null,
      });
    } finally {
      setSendingTicks(null);
    }
  }
  /* What a column's bar sums. The board cannot know what a point is, so the
     owner names a number property, and none means each task counts one. */
  const numbers = data.properties.filter((p) => p.type === "number");

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
  /* Unlike a name, the rules may be emptied on purpose, so an empty box is an
     edit too. */
  const rulesEdit = typedRules && rules.trim() !== savedRules ? rules.trim() : null;
  useSaveOnLeave(() =>
    rulesEdit !== null ? { method: "PATCH", url, body: { agentRules: rulesEdit } } : null,
  );

  async function save(patch: {
    name?: string;
    key?: string;
    doneWhen?: DoneWhen | null;
    progressBy?: string | null;
    timeZone?: string;
    publicChangelog?: boolean;
    agentRules?: string;
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
      setRules(savedRules);
    }
  }

  /*
   * Use releases or Use sprints. On makes the property and its views, or takes
   * the one already there; off clears the switch and keeps everything.
   */
  async function setPlan(what: "releases" | "sprints", on: boolean) {
    if (switching) return;
    setSwitching(true);
    const at = `/api/projects/${data.project.id}/${what}`;
    try {
      if (!on) await send.del(at);
      else if (what === "releases") await send.post(at, {});
      else await send.post(at, { length: Number(sprintLength.trim()), startAt: sprintStart });
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : `Could not turn ${what} ${on ? "on" : "off"}.`);
    } finally {
      setSwitching(false);
    }
  }

  async function flipPublic() {
    if (flipping) return;
    setFlipping(true);
    try {
      await save({ publicChangelog: !data.project.publicChangelog });
    } finally {
      setFlipping(false);
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

      <Section title="Name and key">
        <Card>
          <Row>
            <Field label="Name" inline>
              <Input
                grow
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
                width="short"
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
                ⚠ {taskCount} {taskCount === 1 ? "task is" : "tasks are"} called {data.project.key}
                -… today. Leaving this box renames all of them. Links and agent instructions that
                use the old key stop working.
              </span>
            </Row>
          )}
          {!canEdit && (
            <Row>
              <Note>Only the owner or an admin can change the name and the key.</Note>
            </Row>
          )}
        </Card>
      </Section>

      <Section title="Dates and progress">
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
                width="long"
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
                Today is {data.today} here. A filter that says <b>Due this week</b> or{" "}
                <b>Overdue</b> is worked out in this zone, for everybody on the board.
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
         * The property and its ticks are one answer, so they sit on one row.
         * Picking a property with no option yet writes nothing: the answer is
         * the options. Each saves the moment it changes — a dropdown or a tick
         * has no draft to lose, so the change is its blur.
         */}
        <Card>
          <Row>
            <Field label="Done when" inline>
              <Select
                aria-label="The property that says a task is done"
                value={doneProperty?.id ?? ""}
                disabled={!canEdit || selects.length === 0}
                onChange={(picked) => {
                  /* The same property again is the same question, so it is not
                   asked twice: re-picking it would otherwise throw away the
                   option that is already the answer. */
                  if (picked === (doneProperty?.id ?? "")) return;
                  setPickedId(picked);
                  /* Another property is another question, so the old answer
                   goes now rather than when the new one arrives. */
                  void save({ doneWhen: null });
                }}
                options={[
                  { value: "", label: "Archived only" },
                  ...selects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              {doneProperty && (
                <div
                  role="group"
                  aria-label="The options that say a task is done"
                  className={styles.doneOptions}
                >
                  {doneProperty.options.map((o) => (
                    <Checkbox
                      key={o.id}
                      label={o.name}
                      checked={ticks.includes(o.id)}
                      disabled={!canEdit || sendingTicks !== null}
                      onChange={(e) => void tickDone(o.id, e.target.checked)}
                    />
                  ))}
                </div>
              )}
              <Note>
                A task that blocks another stops blocking when it is archived, or when it reaches
                any option ticked here.
              </Note>
            </Field>
          </Row>
          {selects.length === 0 && (
            <Row>
              <Note>
                This board has no select property with options, so archived is the answer.
              </Note>
            </Row>
          )}
          <Row>
            <Field label="Count progress by" inline>
              <Select
                aria-label="Count progress by"
                value={data.project.progressBy ?? ""}
                disabled={!canEdit || numbers.length === 0}
                onChange={(picked) => void save({ progressBy: picked || null })}
                options={[
                  { value: "", label: "Tasks" },
                  ...numbers.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              <Note>
                A column with a target date shows how much of it is done. A task with no value
                counts zero.
              </Note>
            </Field>
          </Row>
          {!canEdit && (
            <Row>
              <Note>Only the owner or an admin can change what this project calls done.</Note>
            </Row>
          )}
        </Card>
      </Section>

      {/*
       * How an agent works on this board. No field is hardcoded, so only the
       * project can say which option means review or what done means. The
       * text goes into every run, which is what the count under it is for.
       */}
      <Section title="Agents">
        <Card>
          <Row>
            <Field
              label="Agent rules"
              note={
                <>
                  <span data-testid="agent-rules-count">{rulesCount(rules)}</span>
                  {rules.length > AGENT_RULES_SOFT
                    ? ". Every run carries the whole text, so a shorter one costs less."
                    : ". Markdown. An agent reads this when it claims a task, and obeys it."}
                </>
              }
            >
              <TextArea
                aria-label="Agent rules"
                rows={8}
                value={rules}
                maxLength={AGENT_RULES_MAX}
                disabled={!canEdit}
                placeholder={
                  "Which option means review, when to ask a person, what an estimate means, what done means."
                }
                onChange={(e) => {
                  setRules(e.target.value);
                  setTypedRules(true);
                }}
                onBlur={() => {
                  setTypedRules(false);
                  if (rulesEdit !== null) void save({ agentRules: rulesEdit });
                }}
              />
            </Field>
          </Row>
          {!canEdit && (
            <Row>
              <Note>Only the owner or an admin can change the agent rules.</Note>
            </Row>
          )}
        </Card>
      </Section>

      {/*
       * Releases and sprints are a property and its views, nothing more, so
       * each switch says which ones before it makes them. The switch reads
       * the project's pointer, never a property's name.
       */}
      {canEdit && (
        <Section title="Releases and sprints">
          <Card>
            {releasesOff.asking && release ? (
              <ConfirmRow
                question={offQuestion("release", release, data.tasks, data.views)}
                confirmLabel="Yes, turn off"
                onConfirm={() => releasesOff.confirm(() => void setPlan("releases", false))}
                onCancel={releasesOff.cancel}
              />
            ) : (
              <Row>
                <Field
                  label="Releases"
                  inline
                  note={
                    release ? (
                      <>
                        Releases are the options of <b>{release.name}</b>. Each one has dates,
                        ships, and has a bar on the roadmap.
                      </>
                    ) : (
                      <>
                        Adds a property <b>Release</b> with no releases yet, and a roadmap{" "}
                        <b>Roadmap</b> with a bar for each one. You can rename or delete each one
                        afterwards.
                      </>
                    )
                  }
                >
                  <Checkbox
                    role="switch"
                    label="Use releases"
                    checked={release !== null}
                    disabled={switching}
                    onChange={() => (release ? releasesOff.ask() : void setPlan("releases", true))}
                  />
                </Field>
              </Row>
            )}
            {sprintsOff.asking && sprint ? (
              <ConfirmRow
                question={offQuestion("sprint", sprint, data.tasks, data.views)}
                confirmLabel="Yes, turn off"
                onConfirm={() => sprintsOff.confirm(() => void setPlan("sprints", false))}
                onCancel={sprintsOff.cancel}
              />
            ) : (
              <Row>
                <Field
                  label="Sprints"
                  inline
                  note={
                    sprint ? (
                      <>
                        Sprints are the options of <b>{sprint.name}</b>. A sprint is current while
                        its dates hold today, and each Close makes the next one.
                      </>
                    ) : (
                      <>
                        Adds a sprint property <b>Sprint</b> with Sprint 1 from that day and Sprint
                        2 after it, a board <b>Sprint</b> that shows the current sprint, and a list{" "}
                        <b>Backlog</b> of the tasks in no sprint. A sprint is current while its
                        dates hold today. Each Close makes the next sprint. You can rename or delete
                        each one afterwards.
                      </>
                    )
                  }
                >
                  <Checkbox
                    role="switch"
                    label="Use sprints"
                    checked={sprint !== null}
                    disabled={switching}
                    onChange={() => (sprint ? sprintsOff.ask() : void setPlan("sprints", true))}
                  />
                  {!sprint && (
                    <>
                      <label className={styles.cadenceBox}>
                        <Input
                          aria-label="Sprint length in days"
                          inputMode="numeric"
                          className={styles.cadenceInput}
                          value={sprintLength}
                          onChange={(e) => setSprintLength(e.target.value)}
                        />
                        days, from
                      </label>
                      <Input
                        aria-label="First day of the first sprint"
                        type="date"
                        value={sprintStart}
                        onChange={(e) => setSprintStart(e.target.value)}
                      />
                    </>
                  )}
                </Field>
              </Row>
            )}
          </Card>
        </Section>
      )}

      {/* A member with releases off has nothing here, so no empty heading. */}
      {(data.project.releaseBy || canEdit) && (
        <Section title="Sharing and export">
          {/*
           * The changelog, for people with no account. Off until somebody turns
           * it on, because it shows the titles of the shipped tasks to anyone
           * who has the address. The address is the key, so a project whose key
           * another public project already has is refused, with that sentence.
           * With releases off both pages are not found, so the block goes too;
           * the flag stays stored and comes back with releases.
           */}
          {data.project.releaseBy && (
            <Card>
              <Row>
                <Field
                  label="Public changelog"
                  inline
                  note={
                    data.project.publicChangelog ? (
                      <>
                        Anyone with the address reads the shipped options and the titles of their
                        tasks, with no keys and no people:{" "}
                        <a
                          href={`/changelog/${changelogSlug(data.project.key)}`}
                          data-testid="public-changelog-link"
                        >
                          /changelog/{changelogSlug(data.project.key)}
                        </a>
                      </>
                    ) : (
                      "Only the members of this project read its changelog."
                    )
                  }
                >
                  <Button
                    variant="ghost"
                    disabled={!canEdit || flipping}
                    onClick={() => void flipPublic()}
                  >
                    {data.project.publicChangelog ? "Make it private" : "Make it public"}
                  </Button>
                </Field>
              </Row>
              <Row>
                <a href={`/p/${data.project.id}/changelog`}>Changelog</a>
              </Row>
              {!canEdit && (
                <Row>
                  <Note>Only the owner or an admin can make the changelog public.</Note>
                </Row>
              )}
            </Card>
          )}

          {/*
           * The file holds every member's email, so it is an admin's, as the
           * route says. The server answers with an attachment, so following it
           * saves the file and leaves this page where it is.
           */}
          {canEdit && (
            <Card>
              <Row>
                <Field label="Export" inline>
                  <ButtonLink
                    variant="ghost"
                    href={`/api/projects/${data.project.id}/export`}
                    download
                  >
                    Download
                  </ButtonLink>
                  <Note>
                    One JSON file with the properties, views, members, and every live and archived
                    task with its values, checklist and comments.
                  </Note>
                </Field>
              </Row>
            </Card>
          )}
        </Section>
      )}

      {!files && (
        <Section title="Files">
          <Card>
            <Row>
              <Note>{FILES_OFF_NOTE}</Note>
            </Row>
          </Card>
        </Section>
      )}

      {isOwner && (
        <Section title="Danger zone">
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
                  width="short"
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
        </Section>
      )}
    </>
  );
}
