"use client";

import { useState } from "react";
import { useBoard } from "@/components/board/store";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, NameInput, Select } from "@/components/ui/Form";
import { Card, Foot, Note, Row, Spacer, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { GROUPABLE_TYPES, type ViewDTO } from "@/lib/types";
import { PageHead } from "./SettingsShell";

export function ViewsPanel() {
  const { data, createView } = useBoard();
  const groupable = data.properties.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const [name, setName] = useState("");
  const [groupById, setGroupById] = useState(groupable[0]?.id ?? "");

  async function create() {
    const chosen = groupById || groupable[0]?.id;
    if (!chosen) return;
    const property = data.properties.find((p) => p.id === chosen);
    const title = name.trim() || `By ${property?.name.toLowerCase() ?? "property"}`;
    setName("");
    await createView(title, chosen);
  }

  return (
    <>
      <PageHead
        title="Views"
        note="Each view is a board grouped by one property. The same tasks, looked at from another angle."
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
          <Button onClick={() => void create()} disabled={groupable.length === 0}>
            Add view
          </Button>
          {groupable.length === 0 && (
            <span style={{ width: "100%" }}>
              <Note>Create a select, person or checkbox property first.</Note>
            </span>
          )}
        </Foot>
      </Card>
    </>
  );
}

function ViewRow({
  view,
  groupable,
}: {
  view: ViewDTO;
  groupable: { id: string; name: string }[];
}) {
  const { data, updateView, deleteView } = useBoard();
  const confirm = useConfirm();
  const isOwner = data.project.role === "owner";

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
