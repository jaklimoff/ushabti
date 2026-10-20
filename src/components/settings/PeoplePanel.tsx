"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { emailedLine } from "@/lib/emailed";
import { INVITE_DAYS } from "@/lib/invite-link";
import { editedText } from "@/lib/leave";
import {
  AGENT_ACTS,
  AGENT_ACT_WORDS,
  agentMay,
  maySaid,
  canManage,
  isOwner,
  outranks,
  roleChangeRefusal,
  rolesOffered,
  type AgentAct,
  type Role,
} from "@/lib/roles";
import { isListening } from "@/lib/presence";
import { useBoard } from "@/components/board/store";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";
import { Chevron } from "@/components/ui/Marks";
import {
  Checkbox,
  ColorSwatches,
  FaceSwatches,
  Field,
  Input,
  Label,
  Select,
} from "@/components/ui/Form";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { Card, EmptyState, Foot, FootNote, Note, Row, Section, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { TokenRow } from "@/components/ui/TokenRow";
import type { AgentDTO, InviteDTO, MemberDTO } from "@/lib/types";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

/** `mail` is whether the server sends email at all; off, no screen mentions it. */
export function PeoplePanel({ mail }: { mail: boolean }) {
  const { data } = useBoard();
  const [agents, setAgents] = useState<AgentDTO[] | null>(null);
  const projectId = data.project.id;

  const loadAgents = useCallback(async () => {
    try {
      const res = await api.get<{ agents: AgentDTO[] }>(`/api/projects/${projectId}/agents`);
      setAgents(res.agents);
    } catch {
      setAgents([]);
    }
  }, [projectId]);

  // The agent list is not part of the board, so it is fetched rather than
  // rendered on the server: the token tick has to be able to ask again.
  useEffect(() => {
    let alive = true;
    void api
      .get<{ agents: AgentDTO[] }>(`/api/projects/${projectId}/agents`)
      .then((res) => alive && setAgents(res.agents))
      .catch(() => alive && setAgents([]));
    return () => {
      alive = false;
    };
  }, [projectId]);

  return (
    <>
      <PageHead
        title="People"
        note="Everybody here can create, edit and move tasks. An admin also adds people and agents and changes the shape of the project; only the owner can delete it. An agent is always a member — it just signs in with a token."
      />
      <Members mail={mail} />
      <Agents agents={agents} reload={loadAgents} />
    </>
  );
}

/* ------------------------------------------------------------------ */

function Members({ mail }: { mail: boolean }) {
  const { data, refresh, notify, user, send } = useBoard();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string | null>(null);
  /** The link, held until the person leaves the page, as a reset link is. */
  const [invited, setInvited] = useState<{ email: string; link: string; emailed: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const canEdit = canManage(data.project.role);

  async function invite() {
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setInvited(null);
    try {
      const answer = await send.post<{ invite?: InviteDTO; link?: string; emailed?: boolean }>(
        `/api/projects/${data.project.id}/members`,
        { email: value, role },
      );
      // No account yet, so the email waits as an invite: say what happens next.
      if (answer.invite && answer.link) {
        setInvited({
          email: answer.invite.email,
          link: answer.link,
          emailed: answer.emailed === true,
        });
      }
      setEmail("");
      setRole("member");
      await refresh();
    } catch (err) {
      // Inline rather than a toast: the next step is the link underneath.
      setError(err instanceof Error ? err.message : "Could not add that person.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: MemberDTO) {
    try {
      await send.del(`/api/projects/${data.project.id}/members/${member.id}`);
      if (member.id === user.id) router.replace("/projects");
      else await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not remove that person.");
    }
  }

  async function changeRole(member: MemberDTO, role: Role) {
    try {
      await send.patch(`/api/projects/${data.project.id}/members/${member.id}`, { role });
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not change that role.");
    }
  }

  async function withdraw(invite: InviteDTO) {
    try {
      await send.del(
        `/api/projects/${data.project.id}/invites/${encodeURIComponent(invite.email)}`,
      );
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not withdraw that invite.");
    }
  }

  const people = data.members.filter((m) => m.kind === "human");
  /* The route asks the role rule as if the new person were a member being
     given this role, so the select offers what that rule allows. */
  const inviteRoles = (["member", "admin"] as const).filter(
    (next) =>
      next === "member" ||
      !roleChangeRefusal({
        actor: data.project.role,
        target: "member",
        targetKind: "human",
        next,
        self: false,
      }),
  );
  const inviteLine = invited && emailedLine(mail, invited.emailed, invited.email);

  return (
    <Section title="Members">
      <Card>
        <div className={`${styles.cardHead} ${styles.memberHead}`}>
          <span className={styles.memberHeadWho}>Person</span>
          <span className={styles.memberHeadRole}>Role</span>
        </div>
        {people.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isSelf={member.id === user.id}
            canRemove={
              member.id === user.id
                ? !isOwner(member.role)
                : outranks(data.project.role, member.role)
            }
            /* Never your own row: /account changes a password you know. The
               route asks the same `outranks`, so an admin gets it for a
               member and only the owner for an admin. */
            canReset={member.id !== user.id && outranks(data.project.role, member.role)}
            roles={rolesOffered(data.project.role, member.role, member.kind, member.id === user.id)}
            onRole={(role) => void changeRole(member, role)}
            projectId={data.project.id}
            mail={mail}
            onRemove={() => void remove(member)}
          />
        ))}
        {data.invites.map((invite) => (
          <InviteRow
            key={invite.email}
            invite={invite}
            canWithdraw={canEdit}
            onWithdraw={() => void withdraw(invite)}
          />
        ))}

        {canEdit && (
          <Foot>
            <Input
              grow
              aria-label="Email of the new member"
              value={email}
              invalid={error !== null}
              placeholder="friend@example.com"
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
                setInvited(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && void invite()}
            />
            {inviteRoles.length > 1 && (
              <span className={styles.inviteRole}>
                <Select
                  aria-label="Role of the new member"
                  block
                  value={role}
                  onChange={(picked) => setRole(picked as Role)}
                  options={inviteRoles.map((r) => ({ value: r, label: roleWord(r) }))}
                />
              </span>
            )}
            <Button variant="ghost" onClick={() => void invite()} disabled={busy}>
              {busy ? "Adding…" : "Add member"}
            </Button>
            {error ? (
              <FootNote>
                <span className={styles.footError} role="alert">
                  {error}
                </span>
              </FootNote>
            ) : invited ? (
              <FootNote>
                <Note>
                  {inviteLine === null ? (
                    <>
                      {invited.email} has no account yet, so it is invited. Send them this link;
                      they are in the moment they sign up with it. It works once, for {INVITE_DAYS}{" "}
                      days.
                    </>
                  ) : (
                    <>
                      {inviteLine} They have no account yet; they are in the moment they sign up
                      with this link. It works once, for {INVITE_DAYS} days.
                    </>
                  )}
                </Note>
                <CopyField value={invited.link} label="the invite link" />
              </FootNote>
            ) : (
              <FootNote>
                <Note>
                  A person with an account joins at once. One without gets an invite link, and joins
                  when they sign up with it — even on a closed board.
                </Note>
              </FootNote>
            )}
          </Foot>
        )}
      </Card>
    </Section>
  );
}

function MemberRow({
  member,
  isSelf,
  canRemove,
  canReset,
  roles,
  onRole,
  projectId,
  mail,
  onRemove,
}: {
  member: MemberDTO;
  isSelf: boolean;
  canRemove: boolean;
  canReset: boolean;
  /** The roles the select offers; empty when this row has no select. */
  roles: Role[];
  onRole: (role: Role) => void;
  projectId: string;
  mail: boolean;
  onRemove: () => void;
}) {
  const { notify, send } = useBoard();
  const confirm = useConfirm();
  const reset = useConfirm();
  const handOver = useConfirm();
  /** The link, held until the person leaves the page, as a token is. */
  const [link, setLink] = useState<{ link: string; emailed: boolean } | null>(null);

  async function makeLink() {
    try {
      const res = await send.post<{ link: string; emailed?: boolean }>(
        `/api/projects/${projectId}/members/${member.id}/reset`,
      );
      setLink({ link: res.link, emailed: res.emailed === true });
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not make a reset link.");
    }
  }

  if (confirm.asking) {
    return (
      <ConfirmRow
        question={
          isSelf
            ? "Leave this project? Only the owner or an admin can put you back."
            : `Remove ${member.name}? They lose the board; their tasks and comments stay.`
        }
        confirmLabel={isSelf ? "Yes, leave" : "Yes, remove"}
        onConfirm={() => confirm.confirm(onRemove)}
        onCancel={confirm.cancel}
      />
    );
  }

  if (handOver.asking) {
    return (
      <ConfirmRow
        question={`Make ${member.name} the owner? You become an admin.`}
        confirmLabel="Yes, make owner"
        onConfirm={() => handOver.confirm(() => onRole("owner"))}
        onCancel={handOver.cancel}
      />
    );
  }

  if (reset.asking) {
    return (
      <ConfirmRow
        question={`Make a reset link for ${member.name}? It signs them out everywhere once used.`}
        confirmLabel="Yes, make a link"
        onConfirm={() => reset.confirm(() => void makeLink())}
        onCancel={reset.cancel}
      />
    );
  }

  return (
    <>
      {/* Columns, so the role of every row starts in one place: who, their
          role, then what can be done to them. */}
      <Row className={styles.memberRow}>
        <span className={styles.memberFace}>
          <Avatar name={member.name} color={member.color} emoji={member.emoji} size={32} />
        </span>
        <span className={styles.memberWho}>
          <span className={styles.memberNameLine}>
            <span className={styles.memberName}>{member.name}</span>
            {isSelf && <Tag>you</Tag>}
          </span>
          <span className={styles.memberMail}>{member.email}</span>
        </span>
        <span className={styles.memberMeta}>
          <span className={styles.memberRole}>
            {roles.length > 0 ? (
              /* Saves on change. Only the hand-over asks first, because it is
                 the one change that takes something from the person making it. */
              <Select
                aria-label={`Role of ${member.name}`}
                block
                value={member.role}
                onChange={(picked) => {
                  const next = picked as Role;
                  if (next === "owner") handOver.ask();
                  else onRole(next);
                }}
                options={roles.map((role) => ({ value: role, label: roleWord(role) }))}
              />
            ) : (
              <span className={styles.roleText}>{roleWord(member.role)}</span>
            )}
          </span>
          {canReset && (
            <span className={styles.memberReset}>
              <Button variant="text" onClick={reset.ask}>
                Reset password
              </Button>
            </span>
          )}
        </span>
        {canRemove && (
          <IconButton
            danger
            label={isSelf ? "Leave the project" : `Remove ${member.name}`}
            title={isSelf ? "Leave the project" : "Remove from the project"}
            className={styles.memberRemove}
            onClick={confirm.ask}
          >
            ✕
          </IconButton>
        )}
      </Row>
      {link && (
        <div className={styles.resetLink} data-testid="reset-link">
          <Note>
            {emailedLine(mail, link.emailed, member.email ?? member.name) ??
              `Send this to ${member.name}.`}{" "}
            It works once, for 24 hours. Reloading this page hides it for good.
          </Note>
          <CopyField value={link.link} label="the reset link" loud />
        </div>
      )}
    </>
  );
}

function InviteRow({
  invite,
  canWithdraw,
  onWithdraw,
}: {
  invite: InviteDTO;
  canWithdraw: boolean;
  onWithdraw: () => void;
}) {
  const confirm = useConfirm();

  if (confirm.asking) {
    return (
      <ConfirmRow
        question={`Withdraw the invite for ${invite.email}? Its link stops working.`}
        confirmLabel="Yes, withdraw"
        onConfirm={() => confirm.confirm(onWithdraw)}
        onCancel={confirm.cancel}
      />
    );
  }

  return (
    <Row data-testid="invite-row" className={styles.memberRow}>
      <span className={styles.memberFace}>
        <Avatar name={invite.email} color="var(--text-muted)" size={32} />
      </span>
      <span className={styles.memberWho}>
        <span className={styles.memberMail}>{invite.email}</span>
      </span>
      {/* A dead invite stays listed so its email still reads as asked for;
          adding the email again gives it a new link. */}
      <span className={styles.memberMeta}>
        <span className={styles.memberRole}>
          <span className={styles.roleText}>{roleWord(invite.role)}</span>
        </span>
        <span className={styles.memberReset}>
          <Tag accent={invite.live}>{invite.live ? "invited" : "link expired"}</Tag>
        </span>
      </span>
      {canWithdraw && (
        <IconButton
          danger
          label={`Withdraw the invite for ${invite.email}`}
          title="Withdraw the invite"
          className={styles.memberRemove}
          onClick={confirm.ask}
        >
          ✕
        </IconButton>
      )}
    </Row>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Agents are members too, so everything else on this page already works for
 * them. Only two things are theirs alone: they are created here rather than
 * invited by email, and they sign in with a token rather than a password.
 */
function Agents({ agents, reload }: { agents: AgentDTO[] | null; reload: () => Promise<void> }) {
  const { data, notify, refresh, send } = useBoard();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  /** The plain text of a token, held until the person leaves the page. */
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  /** The agents folded open. All start closed; one just added opens, so Connect is one press away. */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const canEdit = canManage(data.project.role);
  const projectId = data.project.id;

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await send.post<{ agent: { id: string } }>(`/api/projects/${projectId}/agents`, {
        name: trimmed,
      });
      setName("");
      setOpen((current) => new Set(current).add(res.agent.id));
      await reload();
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not add the agent.");
    } finally {
      setBusy(false);
    }
  }

  /** True when the token was made, so the name box can close. */
  async function connect(agent: AgentDTO, tokenName: string): Promise<boolean> {
    try {
      const res = await send.post<{ token: { id: string }; secret: string }>(
        `/api/projects/${projectId}/agents/${agent.id}/tokens`,
        { name: tokenName },
      );
      setSecrets((current) => ({ ...current, [res.token.id]: res.secret }));
      await reload();
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not issue a token.");
      return false;
    }
  }

  async function revoke(tokenId: string) {
    try {
      await send.del(`/api/agent-tokens/${tokenId}`);
      setSecrets((current) => {
        const next = { ...current };
        delete next[tokenId];
        return next;
      });
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not revoke the token.");
    }
  }

  /* The board draws the agent too, so the board is asked again with the list. */
  async function changeFace(
    agent: AgentDTO,
    patch: { color?: string; emoji?: string | null },
  ): Promise<void> {
    try {
      await send.patch(`/api/projects/${projectId}/agents/${agent.id}`, patch);
      await reload();
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not change the agent.");
    }
  }

  /* Only the list draws the switches, so only the list is asked again. */
  async function changeAct(agent: AgentDTO, act: AgentAct, on: boolean): Promise<void> {
    try {
      await send.patch(`/api/projects/${projectId}/agents/${agent.id}`, { acts: { [act]: on } });
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not change what the agent may do.");
    }
    await reload();
  }

  /** True when the name was saved; a refused one puts the old name back. */
  async function rename(agent: AgentDTO, next: string): Promise<boolean> {
    try {
      await send.patch(`/api/projects/${projectId}/agents/${agent.id}`, { name: next });
      await reload();
      await refresh();
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not rename the agent.");
      return false;
    }
  }

  async function remove(agent: AgentDTO) {
    try {
      await send.del(`/api/projects/${projectId}/agents/${agent.id}`);
      await reload();
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not remove the agent.");
    }
  }

  return (
    <Section title="Agents">
      <Card>
        {agents === null && (
          <Row>
            <Note>Loading…</Note>
          </Row>
        )}

        {agents !== null && agents.length === 0 && (
          <EmptyState title="No agents yet.">
            An agent is a machine member. It signs in with a token, holds a card, and says on that
            card what it is doing while it works. Name it after the job it does.
          </EmptyState>
        )}

        {(agents ?? []).map((agent) => (
          <AgentBox
            key={agent.id}
            agent={agent}
            projectId={projectId}
            canEdit={canEdit}
            secrets={secrets}
            open={open.has(agent.id)}
            onToggle={() =>
              setOpen((current) => {
                const next = new Set(current);
                if (!next.delete(agent.id)) next.add(agent.id);
                return next;
              })
            }
            onConnect={(tokenName) => connect(agent, tokenName)}
            onRevoke={(id) => void revoke(id)}
            onRemove={() => void remove(agent)}
            onFace={(patch) => changeFace(agent, patch)}
            onRename={(next) => rename(agent, next)}
            onAct={(act, on) => changeAct(agent, act, on)}
            reload={reload}
          />
        ))}

        {canEdit && (
          <Foot>
            <Input
              grow
              aria-label="Name of the new agent"
              value={name}
              placeholder="Builder"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
            <Button variant="ghost" onClick={() => void create()} disabled={busy}>
              Add agent
            </Button>
          </Foot>
        )}
      </Card>
      <p className={styles.agentsAfter}>
        A token that acts as you, not as an agent, is on your{" "}
        <Link href="/account">Account page</Link>.
      </p>
    </Section>
  );
}

function AgentBox({
  agent,
  projectId,
  canEdit,
  secrets,
  open,
  onToggle,
  onConnect,
  onRevoke,
  onRemove,
  onFace,
  onRename,
  onAct,
  reload,
}: {
  agent: AgentDTO;
  projectId: string;
  canEdit: boolean;
  secrets: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  onConnect: (tokenName: string) => Promise<boolean>;
  onRevoke: (tokenId: string) => void;
  onRemove: () => void;
  onFace: (patch: { color?: string; emoji?: string | null }) => Promise<void>;
  onRename: (name: string) => Promise<boolean>;
  onAct: (act: AgentAct, on: boolean) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const confirm = useConfirm();
  /** The name of the token about to be made; null while nobody is making one. */
  const [naming, setNaming] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const face = usePickedFace(agent, onFace);
  const box = useRef<HTMLInputElement>(null);
  /* The box holds a name that another tab can change under it, so only what
     this tab typed may be written back. */
  const [typed, setTyped] = useState(false);
  const listening = agent.tokens.some((token) => isListening(token.listeningAt));
  const tokens = agent.tokens.length;
  const detail = useId();

  /* The name saves on blur, and a closed tab sends no blur. */
  useSaveOnLeave(() => {
    const edit = typed ? editedText(box.current?.value ?? "", agent.name) : null;
    return edit
      ? {
          method: "PATCH",
          url: `/api/projects/${projectId}/agents/${agent.id}`,
          body: { name: edit },
        }
      : null;
  });

  async function make() {
    const tokenName = (naming ?? "").trim();
    if (!tokenName || making) return;
    setMaking(true);
    const made = await onConnect(tokenName);
    setMaking(false);
    if (made) setNaming(null);
  }

  return (
    <div className={styles.agentBox} data-testid="agent-box">
      {/* Folded, an agent is one line: who, what it may do, whether it hears. */}
      <button
        type="button"
        className={styles.agentHead}
        aria-expanded={open}
        aria-controls={open ? detail : undefined}
        onClick={onToggle}
      >
        <Avatar
          name={agent.name}
          color={face.color}
          emoji={face.emoji}
          size={30}
          kind="agent"
          square
        />
        <span className={styles.agentWho}>
          <span className={styles.memberName}>{agent.name}</span>
          <span className={styles.agentSays}>
            {maySaid(agent.acts)} ·{" "}
            {tokens === 0 ? "no token" : `${tokens} ${tokens === 1 ? "token" : "tokens"}`}
          </span>
        </span>
        <span className={listening ? styles.agentHears : styles.agentSilent}>
          <span className={listening ? styles.agentDot : styles.agentDotOff} aria-hidden />
          {listening ? "Listening" : "Silent"}
        </span>
        <Chevron size={12} className={styles.agentCaret} />
      </button>

      {open && (
        <div className={styles.agentDetail} id={detail}>
          <MayLine agent={agent} canEdit={canEdit} onAct={onAct} />

          <div className={styles.agentPart}>
            <Label className={styles.agentLabel}>Tokens</Label>
            <div className={styles.tokens}>
              {agent.tokens.map((token) => (
                <AgentTokenRow
                  key={token.id}
                  token={token}
                  others={tokens - 1}
                  agentName={agent.name}
                  secret={secrets[token.id]}
                  canEdit={canEdit}
                  onRevoke={() => onRevoke(token.id)}
                  reload={reload}
                />
              ))}
              {!canEdit && tokens === 0 && <span className={styles.tokensNone}>None yet.</span>}
              {/* A token is how an agent connects, so the first one is
                  Connect and every one after it is a new token. */}
              {canEdit && naming === null && (
                <div className={styles.tokenNaming}>
                  <Button variant="ghost" onClick={() => setNaming(today())}>
                    {tokens === 0 ? "Connect" : "New token"}
                  </Button>
                </div>
              )}
              {canEdit && naming !== null && (
                <div className={styles.tokenNaming} data-testid="token-name">
                  <Input
                    grow
                    autoFocus
                    maxLength={60}
                    aria-label={`Name of the new token for ${agent.name}`}
                    value={naming}
                    onChange={(e) => setNaming(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void make();
                      if (e.key === "Escape") setNaming(null);
                    }}
                  />
                  <Button onClick={() => void make()} disabled={making || !naming.trim()}>
                    Make token
                  </Button>
                  <Button variant="ghost" onClick={() => setNaming(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>

          {canEdit && (
            <div className={styles.agentPart} data-testid="agent-face">
              <Label className={styles.agentLabel}>Name</Label>
              <div className={styles.agentFace}>
                {/* The part is labelled Name already, so the box carries no second label. */}
                <div className={styles.agentName}>
                  <Input
                    key={agent.name}
                    ref={box}
                    width="medium"
                    maxLength={80}
                    aria-label={`Name of the agent ${agent.name}`}
                    defaultValue={agent.name}
                    onChange={() => setTyped(true)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    onBlur={(e) => {
                      setTyped(false);
                      const input = e.currentTarget;
                      const edit = editedText(input.value, agent.name);
                      if (!edit) {
                        input.value = agent.name;
                        return;
                      }
                      void onRename(edit).then((saved) => {
                        if (!saved) input.value = agent.name;
                      });
                    }}
                  />
                  <span className={styles.agentNameNote}>
                    A mention of the new name wakes it. Its comments and runs show the new name;
                    text already written keeps the old one.
                  </span>
                </div>
                <Field
                  label="Colour"
                  note="Pick one no other agent and no person on the team wears."
                >
                  <ColorSwatches
                    name={agent.name}
                    emoji={face.emoji}
                    kind="agent"
                    label={`Colour of ${agent.name}`}
                    value={face.color}
                    onPick={(color) => face.pick({ color })}
                  />
                </Field>
                <Field
                  label="Emoji"
                  note="Worn on the colour in place of the ◆, with a small ◆ beside it."
                >
                  <FaceSwatches
                    name={agent.name}
                    color={face.color}
                    kind="agent"
                    label={`Emoji of ${agent.name}`}
                    value={face.emoji}
                    onPick={(emoji) => face.pick({ emoji })}
                  />
                </Field>
              </div>
            </div>
          )}

          {canEdit &&
            (confirm.asking ? (
              <ConfirmRow
                question={`Remove ${agent.name}? Its tokens stop working at once. Its runs, its comments and its activity stay on the tasks.`}
                confirmLabel="Yes, remove"
                onConfirm={() => confirm.confirm(onRemove)}
                onCancel={confirm.cancel}
              />
            ) : (
              <div className={styles.agentFoot}>
                <span className={styles.agentFootSay}>
                  A switch only takes away: it never gives {agent.name} more than a member has.
                </span>
                <Button variant="ghost" className={styles.agentRemove} onClick={confirm.ask}>
                  Remove {agent.name}
                </Button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * What an admin lets this agent do on this board. A switch only takes away,
 * and the server refuses an act that is off whatever the agent was told. A
 * toggle saves on click and holds still until its answer comes, so a second
 * click cannot race the first.
 */
function MayLine({
  agent,
  canEdit,
  onAct,
}: {
  agent: AgentDTO;
  canEdit: boolean;
  onAct: (act: AgentAct, on: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState<AgentAct | null>(null);
  const said = useId();

  async function flip(act: AgentAct, on: boolean) {
    if (saving) return;
    setSaving(act);
    await onAct(act, on);
    setSaving(null);
  }

  return (
    <div className={styles.agentPart} data-testid="agent-may">
      <Label className={styles.agentLabel}>May</Label>
      <div className={styles.mayBlock}>
        <div className={styles.mayGrid}>
          {AGENT_ACTS.map((act) => (
            <Checkbox
              key={act}
              quiet
              className={styles.act}
              label={
                <span className={styles.actSay}>
                  <span className={styles.actName}>{AGENT_ACT_WORDS[act].label}</span>
                  <span id={`${said}-${act}`} className={styles.actNote}>
                    {AGENT_ACT_WORDS[act].note}
                  </span>
                </span>
              }
              aria-label={`${agent.name} may ${AGENT_ACT_WORDS[act].verb}`}
              aria-describedby={`${said}-${act}`}
              checked={agentMay(agent.acts, act)}
              disabled={!canEdit || saving !== null}
              onChange={(e) => void flip(act, e.currentTarget.checked)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A pick shows at once and saves at once, as on the Account page. The saves go
 * out one after another, so the server keeps the last pick, and only the
 * newest pick hands the row back to the saved face: a slow answer never undoes
 * a pick made after it, and a refused one shows the face the server kept.
 */
function usePickedFace(
  agent: AgentDTO,
  save: (patch: { color?: string; emoji?: string | null }) => Promise<void>,
) {
  const [shown, setShown] = useState<{ color?: string; emoji?: string | null }>({});
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  const newest = useRef(0);
  const color = shown.color ?? agent.color;
  const emoji = shown.emoji !== undefined ? shown.emoji : agent.emoji;

  function pick(patch: { color?: string; emoji?: string | null }) {
    if (patch.color === color || (patch.emoji !== undefined && patch.emoji === emoji)) return;
    const turn = (newest.current += 1);
    setShown((current) => ({ ...current, ...patch }));
    saves.current = saves.current.then(async () => {
      await save(patch);
      if (turn === newest.current) setShown({});
    });
  }

  return { color, emoji, pick };
}

function AgentTokenRow({
  token,
  others,
  agentName,
  secret,
  canEdit,
  onRevoke,
  reload,
}: {
  token: AgentDTO["tokens"][number];
  /** How many live tokens the agent keeps once this one is gone. */
  others: number;
  agentName: string;
  secret: string | undefined;
  canEdit: boolean;
  onRevoke: () => void;
  reload: () => Promise<void>;
}) {
  return (
    <TokenRow
      name={token.name}
      prefix={token.prefix}
      testId="token-row"
      fresh={Boolean(secret)}
      question={`Revoke the token “${token.name}”? ${
        others === 0
          ? `${agentName} stops working within one request.`
          : `${agentName} keeps working on its ${others === 1 ? "other token" : `${others} other tokens`}.`
      }`}
      onRevoke={canEdit ? onRevoke : null}
      meta={
        <>
          made {relativeDay(token.createdAt)} ·{" "}
          {isListening(token.listeningAt) ? (
            <span className={styles.tokenLive}>listening now</span>
          ) : token.lastUsedAt ? (
            `last used ${relativeDay(token.lastUsedAt)}`
          ) : (
            "never used"
          )}
        </>
      }
    >
      {secret && (
        <div className={styles.tokenSecret}>
          <Connect
            secret={secret}
            agentName={agentName}
            answered={token.lastUsedAt !== null}
            listening={isListening(token.listeningAt)}
            reload={reload}
          />
        </div>
      )}
    </TokenRow>
  );
}

/**
 * Everything the person has to do next, with the values already in it. The
 * old page printed a file path that is not on the machine of anybody who ran
 * the production image, and left them to work out their own base URL.
 */
function Connect({
  secret,
  agentName,
  answered,
  listening,
  reload,
}: {
  secret: string;
  agentName: string;
  answered: boolean;
  listening: boolean;
  reload: () => Promise<void>;
}) {
  // The board knows its own address; the person was being asked to remember
  // it. Read through a store so the server render stays empty.
  const origin = useSyncExternalStore(
    subscribeNothing,
    () => window.location.origin,
    () => "",
  );

  // The loop is only closed when the token has actually been used, and then
  // again when the watcher in step 4 starts. Watch for both rather than
  // making the person reload and squint at "never used".
  useEffect(() => {
    if (answered && listening) return;
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [answered, listening, reload]);

  const install = `mkdir -p ~/.claude/skills/ushabti && \\
  curl -sL ${origin}/skill/SKILL.md  -o ~/.claude/skills/ushabti/SKILL.md && \\
  curl -sL ${origin}/skill/board.mjs -o ~/.claude/skills/ushabti/board.mjs`;
  const env = `export USHABTI_URL=${origin}\nexport USHABTI_TOKEN=${secret}`;
  const check = `curl -s $USHABTI_URL/api/agent/me -H "Authorization: Bearer $USHABTI_TOKEN"`;
  const watch = `node ~/.claude/skills/ushabti/board.mjs watch --on assigned,mention \\
  --run 'claude -p {prompt} --allowedTools "Bash(node:*)"'`;

  return (
    <div className={styles.connect} data-testid="agent-secret">
      <div className={styles.connectStep}>
        <Label>The token — readable only here, only now</Label>
        <CopyField value={secret} label="the token" loud />
      </div>

      <div className={styles.connectStep}>
        <Label>Connect Claude Code</Label>
        <span className={styles.connectSay}>
          <span className={styles.connectNum}>1</span>
          Put the skill where Claude Code finds it.
        </span>
        <CopyField value={install} label="the install command" />
        <span className={styles.connectSay}>
          <span className={styles.connectNum}>2</span>
          Give it the board and the token.
        </span>
        <CopyField value={env} label="the environment" />
        <span className={styles.connectSay}>
          <span className={styles.connectNum}>3</span>
          Check it.
        </span>
        <CopyField value={check} label="the check command" />
        <span className={styles.connectSay}>
          <span className={styles.connectNum}>4</span>
          Keep it listening, so a task assigned to {agentName} starts it by itself.
        </span>
        <CopyField value={watch} label="the watch command" />
      </div>

      <div className={`${styles.waiting} ${answered ? styles.answered : ""}`}>
        <span className={`${styles.waitDot} ${answered ? styles.answeredDot : ""}`} />
        {listening
          ? `${agentName} is listening.`
          : answered
            ? `${agentName} answered.`
            : "Waiting for the first call from this token…"}
      </div>

      <Note>
        Another framework? Put <code>SKILL.md</code> in the system prompt and ship{" "}
        <code>board.mjs</code> next to your agent.
      </Note>
    </div>
  );
}

/** window.location never changes under us, so there is nothing to subscribe to. */
function subscribeNothing() {
  return () => {};
}

/** A role as a value reads: in sentence case, as every value in settings does. */
function roleWord(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** The local day, as a token's first name: it says when the token was made. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days, so the token list never has to tick. */
function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
