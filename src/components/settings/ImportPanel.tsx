"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CLIENT_ID } from "@/lib/client";
import { useBoard } from "@/components/board/store";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { Card, EmptyState, Foot, Note, Row, Section, Spacer, Tag } from "@/components/ui/Layout";
import type { ImportMadeDTO, ImportPreviewDTO, ImportRowDTO, PropertyDTO } from "@/lib/types";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

/**
 * Bringing a board in from Trello.
 *
 * The page is the flow, because the board has no dialogs: pick a file and the
 * page becomes the preview, press **Import** and it says what was made.
 * Nothing is kept on the server between the two — the browser holds the file
 * and posts it twice — so leaving the page is how you cancel.
 *
 * Every change to the mapping asks the server again rather than working the
 * answer out here. One thing decides what an import does, and it is the same
 * thing that will do it.
 */
export function ImportPanel() {
  const { data, refresh } = useBoard();
  const router = useRouter();
  const projectId = data.project.id;
  const isOwner = data.project.role === "owner";

  /* The file itself, which never leaves the browser between the two posts. */
  const file = useRef<File | null>(null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<ImportPreviewDTO | null>(null);
  const [ask, setAsk] = useState<Ask>({ lists: {}, labels: {}, archived: false });
  const [made, setMade] = useState<ImportMadeDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function look(next: Ask) {
    const picked = file.current;
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ preview: ImportPreviewDTO }>(
        `/api/projects/${projectId}/import/preview`,
        picked,
        next,
      );
      setAsk(next);
      setPreview(res.preview);
    } catch (err) {
      setPreview(null);
      setError(said(err, "Could not read that file."));
    } finally {
      setBusy(false);
    }
  }

  async function bringItIn() {
    const picked = file.current;
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ made: ImportMadeDTO }>(
        `/api/projects/${projectId}/import`,
        picked,
        ask,
      );
      setMade(res.made);
      setPreview(null);
      await refresh();
      router.refresh();
    } catch (err) {
      setError(said(err, "Could not bring that board in."));
    } finally {
      setBusy(false);
    }
  }

  function startAgain() {
    file.current = null;
    setName("");
    setPreview(null);
    setMade(null);
    setError(null);
    setAsk({ lists: {}, labels: {}, archived: false });
  }

  return (
    <>
      <PageHead
        title="Import"
        note="Bring a board in from Trello. Its lists become the columns, its cards become tasks, and nothing is made twice."
      />

      {!isOwner ? (
        <Section title="Import">
          <Card>
            <Row>
              <Note>Only the owner of this project can bring a board in.</Note>
            </Row>
          </Card>
        </Section>
      ) : (
        <>
          <Section title="The file">
            <Card>
              <Row>
                <Field label="Export" inline>
                  <Input
                    type="file"
                    accept="application/json,.json"
                    aria-label="The Trello export to bring in"
                    disabled={busy}
                    onChange={(e) => {
                      const picked = e.target.files?.[0] ?? null;
                      file.current = picked;
                      setName(picked?.name ?? "");
                      setMade(null);
                      const fresh: Ask = { lists: {}, labels: {}, archived: false };
                      setAsk(fresh);
                      if (picked) void look(fresh);
                      else setPreview(null);
                    }}
                  />
                </Field>
              </Row>
              <Row>
                <Note>
                  In Trello: <b>Board menu → More → Print and export → Export as JSON</b>. Up to 5
                  MB and 2000 cards at a time. Trello only, for now.
                </Note>
              </Row>
              {error && (
                <Row>
                  <span className={styles.keyWarn} role="alert">
                    {error}
                  </span>
                </Row>
              )}
              {busy && !preview && (
                <Row>
                  <Note>Reading {name}…</Note>
                </Row>
              )}
            </Card>
          </Section>

          {made && <Made made={made} projectId={projectId} onAgain={startAgain} />}

          {preview && (
            <Preview
              preview={preview}
              properties={data.properties}
              ask={ask}
              busy={busy}
              onAsk={(next) => void look(next)}
              onImport={() => void bringItIn()}
              onAgain={startAgain}
            />
          )}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

/** The answer the owner gives the preview, as both routes read it. */
type Ask = {
  groupPropertyId?: string | null;
  lists: Record<string, string | null>;
  labels: Record<string, string | null>;
  archived: boolean;
};

/** The file and the answer, posted together. A file is not JSON on the wire. */
async function post<T>(url: string, file: File, ask: Ask): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  form.set("mapping", JSON.stringify(ask));
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-ushabti-client": CLIENT_ID },
    body: form,
    cache: "no-store",
  });
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep the default message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function said(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/* ------------------------------------------------------------------ */

function Preview({
  preview,
  properties,
  ask,
  busy,
  onAsk,
  onImport,
  onAgain,
}: {
  preview: ImportPreviewDTO;
  properties: PropertyDTO[];
  ask: Ask;
  busy: boolean;
  onAsk: (next: Ask) => void;
  onImport: () => void;
  onAgain: () => void;
}) {
  const selects = properties.filter((p) => p.type === "select");
  const group = properties.find((p) => p.id === preview.group.propertyId) ?? null;
  const labels = properties.find(
    (p) => p.type === "multi_select" && p.name.toLowerCase() === "labels",
  );
  const nothing = preview.tasks.coming === 0;

  return (
    <>
      <Section title={preview.board} note="What this import will do.">
        <Card>
          <Row>
            <span>Tasks</span>
            <Spacer />
            <Tag accent>{preview.tasks.coming} coming</Tag>
            {preview.tasks.already > 0 && <Tag>{preview.tasks.already} already here</Tag>}
          </Row>
          <Row>
            <Field label="Columns" inline>
              <Select
                aria-label="The property the lists become options of"
                value={preview.group.propertyId ?? ""}
                disabled={busy || selects.length === 0}
                onChange={(e) =>
                  /* Another property is another set of options, so the picks
                     made against the old one go with it. */
                  onAsk({ ...ask, groupPropertyId: e.target.value || null, lists: {} })
                }
              >
                {preview.group.making && <option value="">A new {preview.group.name}</option>}
                {selects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Note>Each list becomes an option of this property.</Note>
            </Field>
          </Row>
          <Row>
            <span>Archived cards</span>
            <Spacer />
            <button
              type="button"
              aria-pressed={preview.archived.coming}
              className={`${styles.kindChip} ${preview.archived.coming ? styles.kindChipOn : ""}`}
              disabled={busy}
              onClick={() => onAsk({ ...ask, archived: !ask.archived })}
            >
              {preview.archived.inFile === 0
                ? "None in the file"
                : preview.archived.coming
                  ? `Bring ${preview.archived.inFile} in, archived`
                  : `Leave ${preview.archived.inFile} behind`}
            </button>
          </Row>
          {preview.properties.some((p) => p.making) && (
            <Row>
              <Note>
                This import adds{" "}
                {preview.properties
                  .filter((p) => p.making)
                  .map((p) => p.name)
                  .join(", ")}{" "}
                to the project, as ordinary properties you can rename or delete.
              </Note>
            </Row>
          )}
        </Card>
      </Section>

      <Rows
        title="Lists"
        note="A name that matches an option is proposed. Point it somewhere else if you would rather."
        rows={preview.lists}
        options={group?.options ?? []}
        busy={busy}
        onPick={(sourceId, optionId) =>
          onAsk({ ...ask, lists: { ...ask.lists, [sourceId]: optionId } })
        }
      />

      {preview.labels.length > 0 && (
        <Rows
          title="Labels"
          note="Each label becomes an option of Labels."
          rows={preview.labels}
          options={labels?.options ?? []}
          busy={busy}
          onPick={(sourceId, optionId) =>
            onAsk({ ...ask, labels: { ...ask.labels, [sourceId]: optionId } })
          }
        />
      )}

      <Section title="What does not come">
        <Card>
          {preview.dropped.map((line) => (
            <Row key={line}>
              <Note>{line}</Note>
            </Row>
          ))}
          {preview.people.named.length > 0 && (
            <Row>
              <Note>
                Nobody here is called {preview.people.named.join(", ")}. No account is made: the
                name goes on the last line of the task instead.
              </Note>
            </Row>
          )}
        </Card>
      </Section>

      <Card>
        <Foot>
          <Button onClick={onImport} disabled={busy || nothing}>
            {nothing ? "Nothing new to bring in" : `Import ${preview.tasks.coming} tasks`}
          </Button>
          <Button variant="ghost" onClick={onAgain} disabled={busy}>
            Choose another file
          </Button>
          <Spacer />
          {nothing && <Note>Every card of this file is already on the board.</Note>}
        </Foot>
      </Card>
    </>
  );
}

/** One block of lists or labels, each with the option it lands on. */
function Rows({
  title,
  note,
  rows,
  options,
  busy,
  onPick,
}: {
  title: string;
  note: string;
  rows: ImportRowDTO[];
  options: { id: string; name: string }[];
  busy: boolean;
  onPick: (sourceId: string, optionId: string | null) => void;
}) {
  return (
    <Section title={title} note={note}>
      <Card>
        {rows.length === 0 && <EmptyState title={`No ${title.toLowerCase()} in this file.`} />}
        {rows.map((row) => (
          <Row key={row.sourceId} data-testid="import-row">
            <span>{row.name}</span>
            <Tag>{row.cards}</Tag>
            <Spacer />
            <Select
              aria-label={`Where ${row.name} goes`}
              value={row.optionId ?? ""}
              disabled={busy}
              onChange={(e) => onPick(row.sourceId, e.target.value || null)}
            >
              <option value="">Add “{row.name}”</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Row>
        ))}
      </Card>
    </Section>
  );
}

/** What one import made, and the way back to the board. */
function Made({
  made,
  projectId,
  onAgain,
}: {
  made: ImportMadeDTO;
  projectId: string;
  onAgain: () => void;
}) {
  return (
    <Section title="Done">
      <Card>
        <Row>
          <span>
            {made.tasks} {made.tasks === 1 ? "task" : "tasks"} and {made.options}{" "}
            {made.options === 1 ? "option" : "options"} are on the board.
          </span>
          <Spacer />
          <Link href={`/p/${projectId}`} className={styles.railLink}>
            Open the board
          </Link>
        </Row>
        {made.already > 0 && (
          <Row>
            <Note>
              {made.already} {made.already === 1 ? "card was" : "cards were"} already here and{" "}
              {made.already === 1 ? "was" : "were"} left alone.
            </Note>
          </Row>
        )}
        <Foot>
          <Button variant="ghost" onClick={onAgain}>
            Bring another board in
          </Button>
        </Foot>
      </Card>
    </Section>
  );
}
