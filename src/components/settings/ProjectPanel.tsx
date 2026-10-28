"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/board";
import { changelogSlug } from "@/lib/changelog";
import { canManage, isOwner as isOwnerRole } from "@/lib/roles";
import { editedText } from "@/lib/leave";
import { useBoard } from "@/components/board/store";
import { Button, ButtonLink } from "@/components/ui/Button";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { Field, Input, ProjectColorSwatches, Select } from "@/components/ui/Form";
import { ConfirmRow } from "@/components/ui/ConfirmRow";
import { Card, Note, Row, Section } from "@/components/ui/Layout";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";
import { FILES_OFF_NOTE } from "@/lib/attachments";
import { DEFAULT_TIME_ZONE } from "@/lib/day";
import { tellNobody } from "@/lib/mounted";

/*
 * The zone names the browser knows, offered as the owner types. They only
 * suggest: this is CLDR's list, which lacks names the server takes, such as
 * Asia/Kolkata and UTC, so the server alone decides. The server draws none,
 * because its list and the browser's can differ, and an older browser has no
 * list at all and keeps a plain box.
 */
const NO_ZONES: string[] = [];
let zoneNames: string[] | null = null;
function zonesInBrowser(): string[] {
  if (zoneNames) return zoneNames;
  if (typeof Intl.supportedValuesOf !== "function") return (zoneNames = NO_ZONES);
  const names = Intl.supportedValuesOf("timeZone");
  return (zoneNames = names.includes(DEFAULT_TIME_ZONE) ? names : [DEFAULT_TIME_ZONE, ...names]);
}
const zonesOnServer = () => NO_ZONES;

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
  const zones = useSyncExternalStore(tellNobody, zonesInBrowser, zonesOnServer);
  const zoneList = useId();
  const [confirming, setConfirming] = useState(false);
  /* A press waits for its answer before it counts again: a second press on a
     switch that has not answered yet would flip it back. */
  const [flipping, setFlipping] = useState(false);
  /* The colour on its way out shows as picked until the answer lands, and a
     second pick waits for it. */
  const [sendingColor, setSendingColor] = useState<string | null>(null);
  /* The admin the row is asking about, by id: a refresh that takes their
     admin role away drops the question rather than naming somebody else. */
  const [heirId, setHeirId] = useState<string | null>(null);
  const [handing, setHanding] = useState(false);

  /* Every task of the project, archived ones too: a rename renames their keys
     as well, and a delete takes them with it. */
  const taskCount = data.taskCount ?? data.tasks.length + data.archived.length;
  const keyChanged = key !== data.project.key && key.length > 0;

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
    color?: string;
    timeZone?: string;
    publicChangelog?: boolean;
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

  async function flipPublic() {
    if (flipping) return;
    setFlipping(true);
    try {
      await save({ publicChangelog: !data.project.publicChangelog });
    } finally {
      setFlipping(false);
    }
  }

  async function pickColor(color: string) {
    if (sendingColor || color === data.project.color) return;
    setSendingColor(color);
    try {
      await save({ color });
    } finally {
      setSendingColor(null);
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

  /* Only an admin is offered: they already run the board, so the hand-over
     moves one word. The route still takes any person the role rule allows. */
  const admins = data.members.filter((m) => m.kind === "human" && m.role === "admin");
  const heir = admins.find((m) => m.id === heirId) ?? null;

  async function handOver(to: string) {
    if (handing) return;
    setHanding(true);
    try {
      await send.patch(`/api/projects/${data.project.id}/members/${to}`, { role: "owner" });
      await refresh();
      router.refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not hand the project over.");
    } finally {
      setHanding(false);
      setHeirId(null);
    }
  }

  /* Who may change what is said once per card, under its last row. */
  const ownersOnly = (what: string) =>
    !canEdit && (
      <Row>
        <Note>Only the owner or an admin can change {what}.</Note>
      </Row>
    );

  /* "Sharing" holds the public changelog, which only exists with releases on.
     The export lives on Import and export, beside the import. */
  const sharing = Boolean(data.project.releaseBy);

  return (
    <>
      <PageHead
        title="Project"
        note="The name and key every task carries, who can read what shipped, and the one thing only the owner does."
      />

      <Section title="General">
        <Card>
          <Row>
            <Field label="Name" inline>
              <Input
                width="long"
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
              <Note>
                Task keys look like <span className={styles.keySample}>{key || "USH"}-14</span>.
              </Note>
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
          <Row>
            <Field label="Colour" inline>
              <ProjectColorSwatches
                projectKey={data.project.key}
                value={sendingColor ?? data.project.color}
                disabled={!canEdit}
                onPick={(color) => void pickColor(color)}
              />
            </Field>
          </Row>
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
          <Row>
            <Field
              label="Time zone"
              inline
              note={
                <>
                  Today is {formatDate(data.today)} here. A filter that says <b>Due this week</b> or{" "}
                  <b>Overdue</b> is worked out in this zone, for everybody on the board.
                </>
              }
            >
              <Input
                width="long"
                aria-label="The time zone this project's day is worked out in"
                list={zones.length ? zoneList : undefined}
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
              {zones.length > 0 && (
                <datalist id={zoneList}>
                  {zones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              )}
            </Field>
          </Row>
          {!files && (
            <Row>
              <Note>{FILES_OFF_NOTE}</Note>
            </Row>
          )}
          {ownersOnly("the name, the key, the colour and the time zone")}
        </Card>
      </Section>

      {/* With releases off there is nothing to share, so no empty heading. */}
      {sharing && (
        <Section title="Sharing">
          <Card>
            {/*
             * The changelog, for people with no account. Off until somebody turns
             * it on, because it shows the titles of the shipped tasks to anyone
             * who has the address. The address is the key, so a project whose key
             * another public project already has is refused, with that sentence.
             * With releases off both pages are not found, so the block goes too;
             * the flag stays stored and comes back with releases.
             */}
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
                <ButtonLink variant="text" href={`/p/${data.project.id}/changelog`}>
                  Changelog
                </ButtonLink>
              </Field>
            </Row>
            {ownersOnly("who reads the changelog")}
          </Card>
        </Section>
      )}

      {/*
       * The one loss so large that a second press is not enough: the row asks
       * for the key, in the same shape as every other question in settings.
       */}
      {isOwner && (
        <Section title="Danger zone">
          <Card className={styles.dangerCard}>
            {heir ? (
              <ConfirmRow
                question={`Make ${heir.name} the owner? You become an admin.`}
                confirmLabel="Yes, hand it over"
                onConfirm={() => void handOver(heir.id)}
                onCancel={() => setHeirId(null)}
              />
            ) : (
              <Row className={styles.dangerRow}>
                <div className={styles.dangerSay}>
                  <span className={styles.dangerTitle}>Hand over</span>
                  <Note>
                    {admins.length > 0
                      ? "The new owner can delete the project. You stay an admin."
                      : "Make somebody an admin first."}
                  </Note>
                </div>
                <Select
                  aria-label="The admin to hand the project to"
                  value=""
                  disabled={admins.length === 0 || handing}
                  onChange={(picked) => setHeirId(picked || null)}
                  options={[
                    { value: "", label: "Pick an admin", disabled: true },
                    ...admins.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
              </Row>
            )}
            {confirming ? (
              <ConfirmRow
                question={
                  <>
                    Delete {data.project.name} and its {taskCount}{" "}
                    {taskCount === 1 ? "task" : "tasks"} for good? Type <b>{data.project.key}</b> to
                    confirm.
                  </>
                }
                typed={{ word: data.project.key, label: "Type the project key to confirm" }}
                confirmLabel="Delete for good"
                onConfirm={() => void remove()}
                onCancel={() => setConfirming(false)}
              />
            ) : (
              <Row className={styles.dangerRow}>
                <div className={styles.dangerSay}>
                  <span className={styles.dangerTitle}>Delete this project</span>
                  <Note>
                    The board, its {taskCount} {taskCount === 1 ? "task" : "tasks"}, its properties,
                    its views and its agents go with it. There is no undo.
                  </Note>
                </div>
                <Button variant="danger" onClick={() => setConfirming(true)}>
                  Delete project
                </Button>
              </Row>
            )}
          </Card>
        </Section>
      )}
    </>
  );
}
