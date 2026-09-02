"use client";

import { useState } from "react";
import { useBoard } from "@/components/board/store";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, NameInput, Select } from "@/components/ui/Form";
import { Card, Foot, Note, Row, Spacer, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import {
  GROUPABLE_TYPES,
  VIEW_KINDS,
  VIEW_KIND_LABEL,
  type PropertyDTO,
  type ViewDTO,
  type ViewKind,
} from "@/lib/types";
import { PageHead } from "./SettingsShell";

export function ViewsPanel() {
  const { data, createView } = useBoard();
  const groupable = data.properties.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ViewKind>("board");
  const [groupById, setGroupById] = useState(groupable[0]?.id ?? "");

  async function create() {
    const chosen = groupById || groupable[0]?.id || null;
    if (kind === "board" && !chosen) return;
    const property = data.properties.find((p) => p.id === chosen);
    const taken = new Set(data.views.map((v) => v.name.toLowerCase()));
    let fallback = `By ${property?.name.toLowerCase() ?? "property"}`;
    if (kind === "list") {
      fallback = "List";
      for (let n = 2; taken.has(fallback.toLowerCase()); n += 1) fallback = `List ${n}`;
    }
    const title = name.trim() || fallback;
    setName("");
    await createView(title, kind, kind === "board" ? chosen : null);
  }

  return (
    <>
      <PageHead
        title="Views"
        note="A view is one way of looking at the same tasks. A board puts them in columns; a list puts them in rows."
      />

      <Card>
        {data.views.map((view) => (
          <ViewRow key={view.id} view={view} groupable={groupable} />
        ))}

        <Foot>
          <Input
            style={{ flex: 1, minWidth: 140 }}
            aria-label="Name of the new view"
            value={name}
            placeholder="View name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <span className="label">Shows as</span>
          <Select
            aria-label="How the new view shows"
            value={kind}
            onChange={(e) => setKind(e.target.value as ViewKind)}
          >
            {VIEW_KINDS.map((option) => (
              <option
                key={option}
                value={option}
                disabled={option === "board" && !groupable.length}
              >
                {VIEW_KIND_LABEL[option]}
              </option>
            ))}
          </Select>
          {/* A list groups nothing, so the question is not asked. Hidden, not
              disabled: a disabled control is a question with no answer. */}
          {kind === "board" && (
            <>
              <span className="label">Columns by</span>
              <Select
                aria-label="Grouping property of the new view"
                value={groupById}
                onChange={(e) => setGroupById(e.target.value)}
              >
                {groupable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </>
          )}
          <Button onClick={() => void create()} disabled={kind === "board" && !groupable.length}>
            Add view
          </Button>
          {groupable.length === 0 && (
            <span style={{ width: "100%" }}>
              <Note>A board needs a select, person or checkbox property. Add one first.</Note>
            </span>
          )}
        </Foot>
      </Card>
    </>
  );
}

function ViewRow({ view, groupable }: { view: ViewDTO; groupable: PropertyDTO[] }) {
  const { data, updateView, deleteView } = useBoard();
  const confirm = useConfirm();
  const isOwner = data.project.role === "owner";

  /*
   * Changing the kind destroys nothing and asks nothing. A board keeps the
   * property it grouped by, unread, so turning it back restores the same
   * columns; and a view that never had one is given the first that will do,
   * in the same breath and one click from being changed. The alternative is a
   * board with no columns, which is a screen that says nothing.
   */
  function setKind(next: ViewKind) {
    if (next === "board" && !view.groupById) {
      const first = groupable[0]?.id;
      if (!first) return;
      void updateView(view.id, { kind: next, groupById: first });
      return;
    }
    void updateView(view.id, { kind: next });
  }

  if (confirm.asking) {
    return (
      <ConfirmRow
        question={`Delete the view ${view.name}? The tasks stay; only this way of looking at them goes.`}
        onConfirm={() => confirm.confirm(() => void deleteView(view.id))}
        onCancel={confirm.cancel}
      />
    );
  }

  return (
    <Row>
      <NameInput
        aria-label={`Name of the view ${view.name}`}
        defaultValue={view.name}
        onBlur={(e) => {
          const value = e.target.value.trim();
          if (value && value !== view.name) void updateView(view.id, { name: value });
          else e.target.value = view.name;
        }}
      />
      {view.isDefault && <Tag accent>main</Tag>}
      <Spacer />
      <span className="label">Shows as</span>
      <Select
        aria-label={`How the view ${view.name} shows`}
        value={view.kind}
        onChange={(e) => setKind(e.target.value as ViewKind)}
      >
        {VIEW_KINDS.map((option) => (
          <option
            key={option}
            value={option}
            disabled={option === "board" && !view.groupById && !groupable.length}
          >
            {VIEW_KIND_LABEL[option]}
          </option>
        ))}
      </Select>
      {view.kind === "board" && (
        <>
          <span className="label">Columns by</span>
          <Select
            aria-label={`Grouping property of the view ${view.name}`}
            value={view.groupById ?? ""}
            onChange={(e) => void updateView(view.id, { groupById: e.target.value })}
          >
            {groupable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </>
      )}
      {!view.isDefault && isOwner && (
        <IconButton
          danger
          label={`Delete the view ${view.name}`}
          title="Delete view"
          onClick={confirm.ask}
        >
          ✕
        </IconButton>
      )}
    </Row>
  );
}
