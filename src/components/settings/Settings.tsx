"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  GROUPABLE_TYPES,
  PROPERTY_TYPES,
  PROPERTY_TYPE_HINT,
  PROPERTY_TYPE_LABEL,
  type MemberDTO,
  type PropertyDTO,
  type PropertyType,
} from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { UserMenu, type SessionUser } from "@/components/ui/UserMenu";
import { BoardProvider, useBoard } from "@/components/board/store";
import type { BoardData } from "@/lib/types";
import styles from "./settings.module.css";

export function Settings({ initial, user }: { initial: BoardData; user: SessionUser }) {
  return (
    <BoardProvider initial={initial} user={user}>
      <SettingsBody />
    </BoardProvider>
  );
}

function SettingsBody() {
  const { data, user } = useBoard();
  const isOwner = data.project.role === "owner";

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <div className={styles.mark}>{data.project.key.slice(0, 1)}</div>
        <Link
          href={`/p/${data.project.id}`}
          className={styles.crumb}
          style={{ color: "var(--text)" }}
        >
          {data.project.name}
        </Link>
        <span className={styles.sep}>/</span>
        <span className={styles.here}>Settings</span>
        <span style={{ flex: 1 }} />
        <Link
          href={`/p/${data.project.id}`}
          className={styles.ghost}
          style={{ lineHeight: "26px" }}
        >
          Back to board
        </Link>
        <UserMenu user={user} />
      </div>

      <div className={styles.body}>
        <ProjectSection isOwner={isOwner} />
        <PropertiesSection />
        <ViewsSection />
        <MembersSection isOwner={isOwner} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProjectSection({ isOwner }: { isOwner: boolean }) {
  const { data, notify, refresh } = useBoard();
  const router = useRouter();
  const [name, setName] = useState(data.project.name);
  const [key, setKey] = useState(data.project.key);
  const [confirming, setConfirming] = useState(false);

  async function save() {
    try {
      await api.patch(`/api/projects/${data.project.id}`, { name, key });
      await refresh();
      router.refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save.");
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
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.h2}>Project</h2>
      </div>
      <div className={styles.card}>
        <div className={styles.rowItem}>
          <span className="label" style={{ width: 60 }}>
            Name
          </span>
          <input
            className={styles.input}
            style={{ flex: 1 }}
            aria-label="Project name"
            value={name}
            disabled={!isOwner}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={styles.rowItem}>
          <span className="label" style={{ width: 60 }}>
            Key
          </span>
          <input
            className={styles.input}
            style={{ width: 110 }}
            aria-label="Project key"
            value={key}
            maxLength={6}
            disabled={!isOwner}
            onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
          <span className={styles.note}>Task keys look like {key || "USH"}-14.</span>
        </div>
        {isOwner && (
          <div className={styles.addForm}>
            <button className={styles.primary} onClick={() => void save()}>
              Save
            </button>
            <span style={{ flex: 1 }} />
            {confirming ? (
              <>
                <span className={styles.error}>Delete the project and every task in it?</span>
                <button className={styles.danger} onClick={() => void remove()}>
                  Yes, delete
                </button>
                <button className={styles.ghost} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className={styles.danger} onClick={() => setConfirming(true)}>
                Delete project
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function PropertiesSection() {
  const { data, addProperty } = useBoard();
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("select");
  const [options, setOptions] = useState("");

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const list =
      type === "select" || type === "multi_select"
        ? options
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    setName("");
    setOptions("");
    await addProperty(trimmed, type, list);
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.h2}>Properties</h2>
        <span className={styles.note}>
          Every field on a task lives here. Nothing is built in — rename, recolour or delete
          whatever you like.
        </span>
      </div>

      <div className={styles.card}>
        {data.properties.map((property, index) => (
          <PropertyRow
            key={property.id}
            property={property}
            upTarget={index >= 2 ? data.properties[index - 2].id : index === 1 ? null : undefined}
            downTarget={data.properties[index + 1]?.id}
          />
        ))}

        <div className={styles.addForm}>
          <input
            className={styles.input}
            style={{ width: 148 }}
            aria-label="New property name"
            value={name}
            placeholder="New property name"
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className={styles.select}
            aria-label="Type of the new property"
            value={type}
            onChange={(e) => setType(e.target.value as PropertyType)}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          {(type === "select" || type === "multi_select") && (
            <input
              className={styles.input}
              style={{ flex: 1, minWidth: 160 }}
              value={options}
              placeholder="Options, separated by commas"
              onChange={(e) => setOptions(e.target.value)}
            />
          )}
          <button className={styles.primary} onClick={() => void create()}>
            Add property
          </button>
          <span className={styles.note} style={{ width: "100%" }}>
            {PROPERTY_TYPE_HINT[type]}
          </span>
        </div>
      </div>
    </section>
  );
}

/**
 * `upTarget` is the property this one lands behind when it moves up: two rows
 * higher, or null for the very top. `undefined` means the row cannot move.
 */
function PropertyRow({
  property,
  upTarget,
  downTarget,
}: {
  property: PropertyDTO;
  upTarget: string | null | undefined;
  downTarget: string | undefined;
}) {
  const { patchProperty, moveProperty, deleteProperty, addOption, patchOption, deleteOption } =
    useBoard();
  const [name, setName] = useState(property.name);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const showOnCard = property.config.showOnCard !== false;
  const canMoveUp = upTarget !== undefined;
  const canMoveDown = downTarget !== undefined;

  return (
    <div className={styles.propBox} data-testid="property-box">
      <div className={styles.propHead}>
        <input
          className={styles.nameInput}
          aria-label={`Name of the ${property.name} property`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== property.name)
              void patchProperty(property.id, { name: trimmed });
            else setName(property.name);
          }}
        />
        <span className={styles.typeTag}>{PROPERTY_TYPE_LABEL[property.type]}</span>
        {GROUPABLE_TYPES.includes(property.type) && (
          <span className={styles.typeTag} title="A view can use this property for its columns">
            groupable
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          className={styles.iconBtn}
          aria-label={`${showOnCard ? "Hide" : "Show"} ${property.name} on the card`}
          title={
            showOnCard ? "Shown on the card. Click to hide." : "Hidden on the card. Click to show."
          }
          onClick={() => void patchProperty(property.id, { showOnCard: !showOnCard })}
          style={{ color: showOnCard ? "var(--accent-soft)" : "#5d646f" }}
        >
          {showOnCard ? "◉" : "○"}
        </button>
        <button
          className={styles.iconBtn}
          aria-label={`Move ${property.name} up`}
          title="Move up"
          disabled={!canMoveUp}
          style={{ opacity: canMoveUp ? 1 : 0.25 }}
          onClick={() => canMoveUp && void moveProperty(property.id, upTarget ?? null)}
        >
          ↑
        </button>
        <button
          className={styles.iconBtn}
          aria-label={`Move ${property.name} down`}
          title="Move down"
          disabled={!canMoveDown}
          style={{ opacity: canMoveDown ? 1 : 0.25 }}
          onClick={() => downTarget && void moveProperty(property.id, downTarget)}
        >
          ↓
        </button>
        <button
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          aria-label={`Delete the property ${property.name}`}
          title="Delete this property and every value in it"
          onClick={() => void deleteProperty(property.id)}
        >
          ✕
        </button>
      </div>

      {(property.type === "select" || property.type === "multi_select") && (
        <div className={styles.options}>
          {property.options.map((option) => (
            <span key={option.id} className={styles.option}>
              <OptionSwatch
                option={option}
                onCommit={(color) => void patchOption(option.id, { color })}
              />
              <input
                className={styles.optionInput}
                aria-label={`Name of the option ${option.name}`}
                defaultValue={option.name}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value && value !== option.name) void patchOption(option.id, { name: value });
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              <button
                className={styles.optionRemove}
                aria-label={`Delete the option ${option.name}`}
                title="Delete option"
                onClick={() => void deleteOption(option.id)}
              >
                ✕
              </button>
            </span>
          ))}
          {adding ? (
            <input
              className={styles.input}
              style={{ height: 24, width: 130 }}
              autoFocus
              value={draft}
              placeholder="Option name"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                const value = draft.trim();
                setDraft("");
                setAdding(false);
                if (value) void addOption(property.id, value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setDraft("");
                  setAdding(false);
                }
              }}
            />
          ) : (
            <button className={styles.optionAdd} onClick={() => setAdding(true)}>
              + option
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A native colour input fires while the user is still dragging inside the
 * picker. Holding the value locally and writing once the picker settles keeps
 * that one gesture from turning into a hundred saves and broadcasts.
 */
function OptionSwatch({
  option,
  onCommit,
}: {
  option: PropertyDTO["options"][number];
  onCommit: (color: string) => void;
}) {
  const [color, setColor] = useState(option.color);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setColor(option.color), [option.color]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function commit(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (next !== option.color) onCommit(next);
  }

  return (
    <input
      className={styles.swatch}
      type="color"
      aria-label={`Colour of ${option.name}`}
      title="Colour"
      value={color}
      onChange={(e) => {
        const next = e.target.value;
        setColor(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(next), 450);
      }}
      onBlur={() => commit(color)}
    />
  );
}

/* ------------------------------------------------------------------ */

function ViewsSection() {
  const { data, updateView, deleteView } = useBoard();
  const groupable = data.properties.filter((p) => GROUPABLE_TYPES.includes(p.type));

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.h2}>Views</h2>
        <span className={styles.note}>Each view is a board grouped by one property.</span>
      </div>
      <div className={styles.card}>
        {data.views.map((view) => (
          <div key={view.id} className={styles.rowItem}>
            <input
              className={styles.nameInput}
              aria-label={`Name of the view ${view.name}`}
              defaultValue={view.name}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== view.name) void updateView(view.id, { name: value });
              }}
            />
            {view.isDefault && <span className={styles.roleTag}>main</span>}
            <span style={{ flex: 1 }} />
            <span className="label">Columns by</span>
            <select
              className={styles.select}
              aria-label={`Grouping property of the view ${view.name}`}
              value={view.groupById ?? ""}
              onChange={(e) => void updateView(view.id, { groupById: e.target.value })}
            >
              {groupable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {!view.isDefault && (
              <button
                className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                aria-label={`Delete the view ${view.name}`}
                title="Delete view"
                onClick={() => void deleteView(view.id)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function MembersSection({ isOwner }: { isOwner: boolean }) {
  const { data, refresh, notify, user } = useBoard();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function invite() {
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${data.project.id}/members`, { email: value });
      setEmail("");
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not add that person.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: MemberDTO) {
    try {
      await api.del(`/api/projects/${data.project.id}/members/${member.id}`);
      if (member.id === user.id) router.replace("/projects");
      else await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not remove that person.");
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.h2}>Members</h2>
        <span className={styles.note}>Everybody in the list can create, edit and move tasks.</span>
      </div>
      <div className={styles.card}>
        {data.members.map((member) => (
          <div key={member.id} className={styles.rowItem}>
            <Avatar name={member.name} color={member.color} size={22} />
            <span className={styles.memberName}>{member.name}</span>
            <span className={styles.memberMail}>{member.email}</span>
            {member.role === "owner" && <span className={styles.roleTag}>owner</span>}
            <span style={{ flex: 1 }} />
            {member.role !== "owner" && (isOwner || member.id === user.id) && (
              <button
                className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                aria-label={member.id === user.id ? "Leave the project" : `Remove ${member.name}`}
                title={member.id === user.id ? "Leave the project" : "Remove from the project"}
                onClick={() => void remove(member)}
              >
                ✕
              </button>
            )}
          </div>
        ))}

        {isOwner && (
          <div className={styles.addForm}>
            <input
              className={styles.input}
              style={{ flex: 1, minWidth: 180 }}
              aria-label="Email of the new member"
              value={email}
              placeholder="friend@example.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void invite()}
            />
            <button className={styles.primary} onClick={() => void invite()} disabled={busy}>
              Add member
            </button>
            <span className={styles.note} style={{ width: "100%" }}>
              The person needs an Ushabti account first. Send them the sign-up link and then add
              their email here.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
